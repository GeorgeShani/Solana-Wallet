//! Claim links for SPL tokens. The tokens sit in the associated token account owned by the
//! `ClaimLink` PDA (the vault).

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{close_account, transfer_checked, CloseAccount, Mint, Token, TokenAccount, TransferChecked},
};

use crate::{constants::*, error::ErrorCode, state::ClaimLink};

#[derive(Accounts)]
pub struct CreateTokenLink<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,
    /// CHECK: only its address is used (as a PDA seed). Whoever holds its private key can claim.
    pub claim_key: UncheckedAccount<'info>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = sender,
        space = 8 + ClaimLink::INIT_SPACE,
        seeds = [CLAIM_SEED, claim_key.key().as_ref()],
        bump
    )]
    pub claim: Account<'info, ClaimLink>,
    #[account(
        init,
        payer = sender,
        associated_token::mint = mint,
        associated_token::authority = claim
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = sender)]
    pub sender_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_token_link(ctx: Context<CreateTokenLink>, amount: u64, expiry: i64) -> Result<()> {
    require!(amount > 0, ErrorCode::ZeroAmount);
    require!(expiry > Clock::get()?.unix_timestamp, ErrorCode::InvalidExpiry);

    let claim = &mut ctx.accounts.claim;
    claim.sender = ctx.accounts.sender.key();
    claim.claim_key = ctx.accounts.claim_key.key();
    claim.mint = ctx.accounts.mint.key();
    claim.amount = amount;
    claim.expiry = expiry;
    claim.bump = ctx.bumps.claim;

    let a = &ctx.accounts;
    transfer_checked(
        CpiContext::new(
            a.token_program.key(),
            TransferChecked {
                from: a.sender_token.to_account_info(),
                mint: a.mint.to_account_info(),
                to: a.vault.to_account_info(),
                authority: a.sender.to_account_info(),
            },
        ),
        amount,
        a.mint.decimals,
    )
}

/// Pays the escrowed tokens to `recipient_token`. Must be signed by the claim key; the
/// transaction's fee payer can be anyone.
#[derive(Accounts)]
pub struct ClaimTokenLink<'info> {
    pub claim_key: Signer<'info>,
    #[account(
        mut,
        seeds = [CLAIM_SEED, claim_key.key().as_ref()],
        bump = claim.bump,
        has_one = sender,
        has_one = mint,
        close = sender,
        constraint = !claim.is_sol() @ ErrorCode::LinkTypeMismatch
    )]
    pub claim: Account<'info, ClaimLink>,
    /// Gets the rent back when the vault and claim accounts close.
    #[account(mut)]
    pub sender: SystemAccount<'info>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = claim)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint)]
    pub recipient_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_claim_token_link(ctx: Context<ClaimTokenLink>) -> Result<()> {
    require!(
        Clock::get()?.unix_timestamp <= ctx.accounts.claim.expiry,
        ErrorCode::ClaimExpired
    );
    let a = &ctx.accounts;
    let bump = [a.claim.bump];
    let seeds = a.claim.signer_seeds(&bump);
    let signer = [&seeds[..]];

    // Pay out the vault's whole balance (not just `amount`) so a stray donation can't block closing it.
    transfer_checked(
        CpiContext::new_with_signer(
            a.token_program.key(),
            TransferChecked {
                from: a.vault.to_account_info(),
                mint: a.mint.to_account_info(),
                to: a.recipient_token.to_account_info(),
                authority: a.claim.to_account_info(),
            },
            &signer,
        ),
        a.vault.amount,
        a.mint.decimals,
    )?;
    close_account(CpiContext::new_with_signer(
        a.token_program.key(),
        CloseAccount {
            account: a.vault.to_account_info(),
            destination: a.sender.to_account_info(),
            authority: a.claim.to_account_info(),
        },
        &signer,
    ))
}

/// The sender cancels a link and gets the tokens and rent back, expired or not.
#[derive(Accounts)]
pub struct RefundTokenLink<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,
    #[account(
        mut,
        seeds = [CLAIM_SEED, claim.claim_key.as_ref()],
        bump = claim.bump,
        has_one = sender,
        has_one = mint,
        close = sender,
        constraint = !claim.is_sol() @ ErrorCode::LinkTypeMismatch
    )]
    pub claim: Account<'info, ClaimLink>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = claim)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = sender)]
    pub sender_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_refund_token_link(ctx: Context<RefundTokenLink>) -> Result<()> {
    let a = &ctx.accounts;
    let bump = [a.claim.bump];
    let seeds = a.claim.signer_seeds(&bump);
    let signer = [&seeds[..]];

    transfer_checked(
        CpiContext::new_with_signer(
            a.token_program.key(),
            TransferChecked {
                from: a.vault.to_account_info(),
                mint: a.mint.to_account_info(),
                to: a.sender_token.to_account_info(),
                authority: a.claim.to_account_info(),
            },
            &signer,
        ),
        a.vault.amount,
        a.mint.decimals,
    )?;
    close_account(CpiContext::new_with_signer(
        a.token_program.key(),
        CloseAccount {
            account: a.vault.to_account_info(),
            destination: a.sender.to_account_info(),
            authority: a.claim.to_account_info(),
        },
        &signer,
    ))
}
