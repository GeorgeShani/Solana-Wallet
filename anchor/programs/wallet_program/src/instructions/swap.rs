use anchor_lang::prelude::*;
use anchor_spl::token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked};

use crate::{constants::*, error::ErrorCode, math, state::Pool};

#[derive(Accounts)]
pub struct Swap<'info> {
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
    #[account(mut, associated_token::mint = mint_a, associated_token::authority = pool)]
    pub vault_a: Box<Account<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = mint_b, associated_token::authority = pool)]
    pub vault_b: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint_a, token::authority = user)]
    pub user_a: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint_b, token::authority = user)]
    pub user_b: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

/// Swaps exactly `amount_in` of one token for at least `min_amount_out` of the other.
/// `a_to_b` picks the direction. Fails with `SlippageExceeded` if the pool would pay less
/// than `min_amount_out`, so a price move between quote and execution can't cost the user
/// more than they agreed to.
pub fn handle_swap(
    ctx: Context<Swap>,
    amount_in: u64,
    min_amount_out: u64,
    a_to_b: bool,
) -> Result<()> {
    let a = &ctx.accounts;
    let (user_in, vault_in, mint_in, user_out, vault_out, mint_out) = if a_to_b {
        (&a.user_a, &a.vault_a, &a.mint_a, &a.user_b, &a.vault_b, &a.mint_b)
    } else {
        (&a.user_b, &a.vault_b, &a.mint_b, &a.user_a, &a.vault_a, &a.mint_a)
    };

    let amount_out = math::swap_output(vault_in.amount, vault_out.amount, amount_in, a.pool.fee_bps)?;
    require!(
        amount_out > 0 && amount_out >= min_amount_out,
        ErrorCode::SlippageExceeded
    );

    let token_program = a.token_program.key();
    transfer_checked(
        CpiContext::new(
            token_program,
            TransferChecked {
                from: user_in.to_account_info(),
                mint: mint_in.to_account_info(),
                to: vault_in.to_account_info(),
                authority: a.user.to_account_info(),
            },
        ),
        amount_in,
        mint_in.decimals,
    )?;

    let bump = [a.pool.bump];
    let seeds = a.pool.signer_seeds(&bump);
    transfer_checked(
        CpiContext::new_with_signer(
            token_program,
            TransferChecked {
                from: vault_out.to_account_info(),
                mint: mint_out.to_account_info(),
                to: user_out.to_account_info(),
                authority: a.pool.to_account_info(),
            },
            &[&seeds[..]],
        ),
        amount_out,
        mint_out.decimals,
    )
}
