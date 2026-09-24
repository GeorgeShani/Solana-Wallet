pub mod constants;
pub mod error;
pub mod instructions;
pub mod math;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("6rAZLb32wv86p3uhqQQCZpDxn4BYiFBX7tqPvw7HpD27");

#[program]
pub mod wallet_program {
    use super::*;

    /// Create an empty pool for (mint_a, mint_b), with mint_a < mint_b.
    pub fn init_pool(ctx: Context<InitPool>, fee_bps: u16) -> Result<()> {
        crate::instructions::init_pool::handle_init_pool(ctx, fee_bps)
    }

    /// Deposit up to the given amounts (in the pool's ratio) and receive LP tokens.
    pub fn add_liquidity(
        ctx: Context<Liquidity>,
        amount_a_desired: u64,
        amount_b_desired: u64,
        min_lp: u64,
    ) -> Result<()> {
        crate::instructions::liquidity::handle_add_liquidity(
            ctx,
            amount_a_desired,
            amount_b_desired,
            min_lp,
        )
    }

    /// Burn LP tokens and withdraw the matching share of both reserves.
    pub fn remove_liquidity(
        ctx: Context<Liquidity>,
        lp_amount: u64,
        min_amount_a: u64,
        min_amount_b: u64,
    ) -> Result<()> {
        crate::instructions::liquidity::handle_remove_liquidity(
            ctx,
            lp_amount,
            min_amount_a,
            min_amount_b,
        )
    }

    /// Swap exactly `amount_in` for at least `min_amount_out` of the other token.
    pub fn swap(
        ctx: Context<Swap>,
        amount_in: u64,
        min_amount_out: u64,
        a_to_b: bool,
    ) -> Result<()> {
        crate::instructions::swap::handle_swap(ctx, amount_in, min_amount_out, a_to_b)
    }

    // ---------------------------------------------------------------- claim links

    /// Escrow `amount` lamports behind a link. Whoever holds the claim key's private key can
    /// claim them before `expiry`; the sender can cancel at any time.
    pub fn create_sol_link(ctx: Context<CreateSolLink>, amount: u64, expiry: i64) -> Result<()> {
        crate::instructions::claim_sol::handle_create_sol_link(ctx, amount, expiry)
    }

    /// Pay a SOL link out to `recipient` (signed by the claim key).
    pub fn claim_sol_link(ctx: Context<ClaimSolLink>) -> Result<()> {
        crate::instructions::claim_sol::handle_claim_sol_link(ctx)
    }

    /// Cancel a SOL link and return the funds to the sender.
    pub fn refund_sol_link(ctx: Context<RefundSolLink>) -> Result<()> {
        crate::instructions::claim_sol::handle_refund_sol_link(ctx)
    }

    /// Escrow `amount` of an SPL token behind a link.
    pub fn create_token_link(ctx: Context<CreateTokenLink>, amount: u64, expiry: i64) -> Result<()> {
        crate::instructions::claim_token::handle_create_token_link(ctx, amount, expiry)
    }

    /// Pay a token link out to `recipient_token` (signed by the claim key).
    pub fn claim_token_link(ctx: Context<ClaimTokenLink>) -> Result<()> {
        crate::instructions::claim_token::handle_claim_token_link(ctx)
    }

    /// Cancel a token link and return the tokens to the sender.
    pub fn refund_token_link(ctx: Context<RefundTokenLink>) -> Result<()> {
        crate::instructions::claim_token::handle_refund_token_link(ctx)
    }

    // ---------------------------------------------------------------- timelocks

    /// Lock `amount` tokens for `recipient` on a schedule: nothing before `cliff`, everything
    /// from `end`, linear from `start` in between. `seed` lets one sender make several locks.
    pub fn create_timelock(
        ctx: Context<CreateTimelock>,
        seed: u64,
        amount: u64,
        start: i64,
        cliff: i64,
        end: i64,
        cancellable: bool,
    ) -> Result<()> {
        crate::instructions::timelock::handle_create_timelock(ctx, seed, amount, start, cliff, end, cancellable)
    }

    /// The recipient withdraws what has vested so far.
    pub fn withdraw_timelock(ctx: Context<WithdrawTimelock>) -> Result<()> {
        crate::instructions::timelock::handle_withdraw_timelock(ctx)
    }

    /// The sender takes back the unvested part (only for cancellable timelocks).
    pub fn cancel_timelock(ctx: Context<CancelTimelock>) -> Result<()> {
        crate::instructions::timelock::handle_cancel_timelock(ctx)
    }

    // ---------------------------------------------------------------- stealth

    /// Publish the ephemeral key of a stealth payment so its recipient can find it.
    pub fn announce(ctx: Context<Announce>, ephemeral: Pubkey, stealth: Pubkey, view_tag: u8) -> Result<()> {
        crate::instructions::stealth::handle_announce(ctx, ephemeral, stealth, view_tag)
    }
}
