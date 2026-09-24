use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{burn, mint_to, transfer_checked, Burn, Mint, MintTo, Token, TokenAccount, TransferChecked},
};

use crate::{constants::*, error::ErrorCode, math, state::Pool};

/// Accounts shared by `add_liquidity` and `remove_liquidity`. The user's token accounts
/// must already exist (the client creates them idempotently in the same transaction).
#[derive(Accounts)]
pub struct Liquidity<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        seeds = [POOL_SEED, pool.mint_a.as_ref(), pool.mint_b.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,
    #[account(address = pool.mint_a)]
    pub mint_a: Box<Account<'info, Mint>>,
    #[account(address = pool.mint_b)]
    pub mint_b: Box<Account<'info, Mint>>,
    #[account(mut, address = pool.lp_mint)]
    pub lp_mint: Box<Account<'info, Mint>>,
    #[account(mut, associated_token::mint = mint_a, associated_token::authority = pool)]
    pub vault_a: Box<Account<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = mint_b, associated_token::authority = pool)]
    pub vault_b: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint_a, token::authority = user)]
    pub user_a: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint_b, token::authority = user)]
    pub user_b: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = lp_mint, token::authority = user)]
    pub user_lp: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handle_add_liquidity(
    ctx: Context<Liquidity>,
    amount_a_desired: u64,
    amount_b_desired: u64,
    min_lp: u64,
) -> Result<()> {
    let a = &ctx.accounts;
    let quote = math::quote_add(
        a.vault_a.amount,
        a.vault_b.amount,
        a.lp_mint.supply,
        amount_a_desired,
        amount_b_desired,
    )?;
    require!(quote.lp >= min_lp, ErrorCode::SlippageExceeded);

    let token_program = a.token_program.key();
    transfer_checked(
        CpiContext::new(
            token_program,
            TransferChecked {
                from: a.user_a.to_account_info(),
                mint: a.mint_a.to_account_info(),
                to: a.vault_a.to_account_info(),
                authority: a.user.to_account_info(),
            },
        ),
        quote.amount_a,
        a.mint_a.decimals,
    )?;
    transfer_checked(
        CpiContext::new(
            token_program,
            TransferChecked {
                from: a.user_b.to_account_info(),
                mint: a.mint_b.to_account_info(),
                to: a.vault_b.to_account_info(),
                authority: a.user.to_account_info(),
            },
        ),
        quote.amount_b,
        a.mint_b.decimals,
    )?;

    let bump = [a.pool.bump];
    let seeds = a.pool.signer_seeds(&bump);
    mint_to(
        CpiContext::new_with_signer(
            token_program,
            MintTo {
                mint: a.lp_mint.to_account_info(),
                to: a.user_lp.to_account_info(),
                authority: a.pool.to_account_info(),
            },
            &[&seeds[..]],
        ),
        quote.lp,
    )
}

pub fn handle_remove_liquidity(
    ctx: Context<Liquidity>,
    lp_amount: u64,
    min_amount_a: u64,
    min_amount_b: u64,
) -> Result<()> {
    let a = &ctx.accounts;
    let (out_a, out_b) = math::quote_remove(
        a.vault_a.amount,
        a.vault_b.amount,
        a.lp_mint.supply,
        lp_amount,
    )?;
    require!(
        out_a >= min_amount_a && out_b >= min_amount_b,
        ErrorCode::SlippageExceeded
    );

    let token_program = a.token_program.key();
    burn(
        CpiContext::new(
            token_program,
            Burn {
                mint: a.lp_mint.to_account_info(),
                from: a.user_lp.to_account_info(),
                authority: a.user.to_account_info(),
            },
        ),
        lp_amount,
    )?;

    let bump = [a.pool.bump];
    let seeds = a.pool.signer_seeds(&bump);
    transfer_checked(
        CpiContext::new_with_signer(
            token_program,
            TransferChecked {
                from: a.vault_a.to_account_info(),
                mint: a.mint_a.to_account_info(),
                to: a.user_a.to_account_info(),
                authority: a.pool.to_account_info(),
            },
            &[&seeds[..]],
        ),
        out_a,
        a.mint_a.decimals,
    )?;
    transfer_checked(
        CpiContext::new_with_signer(
            token_program,
            TransferChecked {
                from: a.vault_b.to_account_info(),
                mint: a.mint_b.to_account_info(),
                to: a.user_b.to_account_info(),
                authority: a.pool.to_account_info(),
            },
            &[&seeds[..]],
        ),
        out_b,
        a.mint_b.decimals,
    )
}
