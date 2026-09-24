//! Claim links for native SOL. The escrowed SOL sits in the `ClaimLink` account itself,
//! on top of its rent, so no extra token accounts are needed.

use anchor_lang::{prelude::*, system_program};

use crate::{constants::*, error::ErrorCode, state::ClaimLink};

#[derive(Accounts)]
pub struct CreateSolLink<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,
    /// CHECK: only its address is used (as a PDA seed). Whoever holds its private key can claim.
    pub claim_key: UncheckedAccount<'info>,
    #[account(
        init,
        payer = sender,
        space = 8 + ClaimLink::INIT_SPACE,
        seeds = [CLAIM_SEED, claim_key.key().as_ref()],
        bump
    )]
    pub claim: Account<'info, ClaimLink>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_sol_link(ctx: Context<CreateSolLink>, amount: u64, expiry: i64) -> Result<()> {
    require!(expiry > Clock::get()?.unix_timestamp, ErrorCode::InvalidExpiry);
    // The recipient may have no account yet, so the payout must be enough to create one.
    require!(amount >= Rent::get()?.minimum_balance(0), ErrorCode::AmountTooSmall);

    let claim = &mut ctx.accounts.claim;
    claim.sender = ctx.accounts.sender.key();
    claim.claim_key = ctx.accounts.claim_key.key();
    claim.mint = Pubkey::default();
    claim.amount = amount;
    claim.expiry = expiry;
    claim.bump = ctx.bumps.claim;

    system_program::transfer(
        CpiContext::new(
            system_program::ID,
            system_program::Transfer {
                from: ctx.accounts.sender.to_account_info(),
                to: ctx.accounts.claim.to_account_info(),
            },
        ),
        amount,
    )
}

/// Pays the escrowed SOL to `recipient`. Must be signed by the claim key; the transaction's fee
/// payer can be anyone (the wallet's relayer pays it, so recipients need no SOL).
#[derive(Accounts)]
pub struct ClaimSolLink<'info> {
    pub claim_key: Signer<'info>,
    #[account(
        mut,
        seeds = [CLAIM_SEED, claim_key.key().as_ref()],
        bump = claim.bump,
        has_one = sender,
        close = sender,
        constraint = claim.is_sol() @ ErrorCode::LinkTypeMismatch
    )]
    pub claim: Account<'info, ClaimLink>,
    /// Gets the account's rent back when it closes.
    #[account(mut)]
    pub sender: SystemAccount<'info>,
    #[account(mut)]
    pub recipient: SystemAccount<'info>,
}

pub fn handle_claim_sol_link(ctx: Context<ClaimSolLink>) -> Result<()> {
    require!(
        Clock::get()?.unix_timestamp <= ctx.accounts.claim.expiry,
        ErrorCode::ClaimExpired
    );
    let amount = ctx.accounts.claim.amount;
    ctx.accounts.claim.sub_lamports(amount)?;
    ctx.accounts.recipient.add_lamports(amount)?;
    Ok(())
}

/// The sender cancels a link and gets everything back (amount and rent), expired or not.
#[derive(Accounts)]
pub struct RefundSolLink<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,
    #[account(
        mut,
        seeds = [CLAIM_SEED, claim.claim_key.as_ref()],
        bump = claim.bump,
        has_one = sender,
        close = sender,
        constraint = claim.is_sol() @ ErrorCode::LinkTypeMismatch
    )]
    pub claim: Account<'info, ClaimLink>,
}

pub fn handle_refund_sol_link(_ctx: Context<RefundSolLink>) -> Result<()> {
    Ok(()) // closing the account returns its rent and the escrowed SOL to the sender
}
