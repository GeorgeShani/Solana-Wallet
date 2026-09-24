use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::{constants::*, error::ErrorCode, state::Pool};

/// Creates an empty pool for a token pair. Anyone can create one; liquidity comes later
/// through `add_liquidity`. Mints must be passed in sorted order so each pair has exactly
/// one canonical pool address.
#[derive(Accounts)]
pub struct InitPool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(constraint = mint_a.key() < mint_b.key() @ ErrorCode::UnsortedMints)]
    pub mint_a: Box<Account<'info, Mint>>,
    pub mint_b: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = payer,
        space = 8 + Pool::INIT_SPACE,
        seeds = [POOL_SEED, mint_a.key().as_ref(), mint_b.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,
    #[account(
        init,
        payer = payer,
        seeds = [LP_MINT_SEED, pool.key().as_ref()],
        bump,
        mint::decimals = LP_DECIMALS,
        mint::authority = pool
    )]
    pub lp_mint: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = mint_a,
        associated_token::authority = pool
    )]
    pub vault_a: Box<Account<'info, TokenAccount>>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = mint_b,
        associated_token::authority = pool
    )]
    pub vault_b: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_pool(ctx: Context<InitPool>, fee_bps: u16) -> Result<()> {
    require!(fee_bps <= MAX_FEE_BPS, ErrorCode::InvalidFee);

    let pool = &mut ctx.accounts.pool;
    pool.mint_a = ctx.accounts.mint_a.key();
    pool.mint_b = ctx.accounts.mint_b.key();
    pool.lp_mint = ctx.accounts.lp_mint.key();
    pool.fee_bps = fee_bps;
    pool.bump = ctx.bumps.pool;
    Ok(())
}
