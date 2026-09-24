//! Time-locked and vesting transfers of SPL tokens (native SOL takes part as wrapped SOL).
//! The tokens sit in the associated token account owned by the `Timelock` PDA (the vault).

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{close_account, transfer_checked, CloseAccount, Mint, Token, TokenAccount, TransferChecked},
};

use crate::{constants::*, error::ErrorCode, math, state::Timelock};

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct CreateTimelock<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,
    /// CHECK: only its address matters. Only this account can withdraw.
    pub recipient: UncheckedAccount<'info>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = sender,
        space = 8 + Timelock::INIT_SPACE,
        seeds = [TIMELOCK_SEED, sender.key().as_ref(), recipient.key().as_ref(), &seed.to_le_bytes()],
        bump
    )]
    pub timelock: Account<'info, Timelock>,
    #[account(
        init,
        payer = sender,
        associated_token::mint = mint,
        associated_token::authority = timelock
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = sender)]
    pub sender_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_timelock(
    ctx: Context<CreateTimelock>,
    seed: u64,
    amount: u64,
    start: i64,
    cliff: i64,
    end: i64,
    cancellable: bool,
) -> Result<()> {
    require!(amount > 0, ErrorCode::ZeroAmount);
    require!(
        start <= cliff && cliff <= end && end > Clock::get()?.unix_timestamp,
        ErrorCode::InvalidSchedule
    );

    let t = &mut ctx.accounts.timelock;
    t.sender = ctx.accounts.sender.key();
    t.recipient = ctx.accounts.recipient.key();
    t.mint = ctx.accounts.mint.key();
    t.seed = seed;
    t.total = amount;
    t.withdrawn = 0;
    t.start = start;
    t.cliff = cliff;
    t.end = end;
    t.bump = ctx.bumps.timelock;
    t.cancellable = cancellable;

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

/// The recipient takes whatever has vested and not yet been withdrawn. When the last of it is
/// taken the vault and timelock accounts close and their rent goes back to the sender.
#[derive(Accounts)]
pub struct WithdrawTimelock<'info> {
    pub recipient: Signer<'info>,
    #[account(
        mut,
        seeds = [TIMELOCK_SEED, timelock.sender.as_ref(), recipient.key().as_ref(), &timelock.seed.to_le_bytes()],
        bump = timelock.bump,
        has_one = sender,
        has_one = mint
    )]
    pub timelock: Account<'info, Timelock>,
    /// Gets the accounts' rent back once everything is withdrawn.
    #[account(mut)]
    pub sender: SystemAccount<'info>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = timelock)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = recipient)]
    pub recipient_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_withdraw_timelock(ctx: Context<WithdrawTimelock>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = &ctx.accounts;
    let t = &a.timelock;

    let vested = math::vested_amount(t.total, t.start, t.cliff, t.end, now);
    let claimable = vested.saturating_sub(t.withdrawn);
    require!(claimable > 0, ErrorCode::NothingToWithdraw);
    let finished = vested >= t.total;
    // At the very end pay out the vault's whole balance so a stray donation can't block closing it.
    let payout = if finished { a.vault.amount } else { claimable };

    let (seed, bump) = (t.seed.to_le_bytes(), [t.bump]);
    let seeds = t.signer_seeds(&seed, &bump);
    let signer = [&seeds[..]];
    transfer_checked(
        CpiContext::new_with_signer(
            a.token_program.key(),
            TransferChecked {
                from: a.vault.to_account_info(),
                mint: a.mint.to_account_info(),
                to: a.recipient_token.to_account_info(),
                authority: a.timelock.to_account_info(),
            },
            &signer,
        ),
        payout,
        a.mint.decimals,
    )?;
    if finished {
        close_account(CpiContext::new_with_signer(
            a.token_program.key(),
            CloseAccount {
                account: a.vault.to_account_info(),
                destination: a.sender.to_account_info(),
                authority: a.timelock.to_account_info(),
            },
            &signer,
        ))?;
    }

    let sender_info = ctx.accounts.sender.to_account_info();
    let t = &mut ctx.accounts.timelock;
    t.withdrawn = t.withdrawn.checked_add(claimable).ok_or(ErrorCode::MathOverflow)?;
    if finished {
        t.close(sender_info)?;
    }
    Ok(())
}

/// The sender takes back what has not vested. What the recipient already earned stays theirs:
/// the schedule is frozen at that amount and they withdraw it as usual, so cancelling never needs
/// the recipient's token account. Only timelocks created as cancellable can be cancelled.
#[derive(Accounts)]
pub struct CancelTimelock<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,
    #[account(
        mut,
        seeds = [TIMELOCK_SEED, sender.key().as_ref(), timelock.recipient.as_ref(), &timelock.seed.to_le_bytes()],
        bump = timelock.bump,
        has_one = sender,
        has_one = mint,
        constraint = timelock.cancellable @ ErrorCode::NotCancellable
    )]
    pub timelock: Account<'info, Timelock>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = timelock)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = sender)]
    pub sender_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_cancel_timelock(ctx: Context<CancelTimelock>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = &ctx.accounts;
    let t = &a.timelock;

    let vested = math::vested_amount(t.total, t.start, t.cliff, t.end, now);
    let owed_to_recipient = vested.saturating_sub(t.withdrawn);
    let refund = a.vault.amount.saturating_sub(owed_to_recipient);
    let nothing_owed = owed_to_recipient == 0;

    let (seed, bump) = (t.seed.to_le_bytes(), [t.bump]);
    let seeds = t.signer_seeds(&seed, &bump);
    let signer = [&seeds[..]];
    if refund > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                a.token_program.key(),
                TransferChecked {
                    from: a.vault.to_account_info(),
                    mint: a.mint.to_account_info(),
                    to: a.sender_token.to_account_info(),
                    authority: a.timelock.to_account_info(),
                },
                &signer,
            ),
            refund,
            a.mint.decimals,
        )?;
    }
    if nothing_owed {
        close_account(CpiContext::new_with_signer(
            a.token_program.key(),
            CloseAccount {
                account: a.vault.to_account_info(),
                destination: a.sender.to_account_info(),
                authority: a.timelock.to_account_info(),
            },
            &signer,
        ))?;
    }

    let sender_info = ctx.accounts.sender.to_account_info();
    let t = &mut ctx.accounts.timelock;
    if nothing_owed {
        t.close(sender_info)
    } else {
        // Freeze the schedule at what the recipient has earned so far: from now on it counts as
        // fully vested, and the recipient withdraws it (closing everything) whenever they like.
        t.total = vested;
        t.start = t.start.min(now);
        t.cliff = t.cliff.min(now);
        t.end = now;
        t.cancellable = false;
        Ok(())
    }
}
