use anchor_lang::prelude::*;

use crate::constants::{CLAIM_SEED, POOL_SEED, TIMELOCK_SEED};

/// A two-token liquidity pool. Reserves are not stored here: they are the balances of
/// the pool's vaults (the pool PDA's associated token accounts for each mint).
#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    pub lp_mint: Pubkey,
    /// Swap fee in basis points, kept in the pool (paid to liquidity providers).
    pub fee_bps: u16,
    pub bump: u8,
}

impl Pool {
    /// Seeds the pool PDA signs with. `bump` must outlive the returned array.
    pub fn signer_seeds<'a>(&'a self, bump: &'a [u8; 1]) -> [&'a [u8]; 4] {
        [POOL_SEED, self.mint_a.as_ref(), self.mint_b.as_ref(), bump]
    }
}

/// Funds held in escrow for whoever holds the private key of `claim_key`.
///
/// The claim key is a throwaway keypair made by the sender's wallet. Its private half is the
/// secret in the shareable link; only its public half ever goes on-chain. Native SOL sits in
/// this account's own lamports; tokens sit in the ATA this PDA owns.
#[account]
#[derive(InitSpace)]
pub struct ClaimLink {
    pub sender: Pubkey,
    pub claim_key: Pubkey,
    /// Token mint, or the all-zero key for a native-SOL link.
    pub mint: Pubkey,
    pub amount: u64,
    /// Unix time after which the link can't be claimed (the sender can still cancel it).
    pub expiry: i64,
    pub bump: u8,
}

impl ClaimLink {
    pub fn is_sol(&self) -> bool {
        self.mint == Pubkey::default()
    }

    /// Seeds the claim PDA signs with (to move tokens out of its vault).
    pub fn signer_seeds<'a>(&'a self, bump: &'a [u8; 1]) -> [&'a [u8]; 3] {
        [CLAIM_SEED, self.claim_key.as_ref(), bump]
    }
}

/// Tokens locked for `recipient` on a schedule: nothing before `cliff`, everything from `end`,
/// and a straight line from `start` to `end` in between (a cliff of `start` means no cliff;
/// `start == cliff == end` is a plain "unlock on this date" transfer).
///
/// Only SPL tokens are held here (in the vault ATA this PDA owns). Native SOL takes part as
/// wrapped SOL: the wallet wraps it before locking and unwraps it when withdrawing.
#[account]
#[derive(InitSpace)]
pub struct Timelock {
    pub sender: Pubkey,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    /// Lets one sender lock several amounts for the same recipient.
    pub seed: u64,
    /// The most the recipient can ever receive (fixed when the schedule is set or cancelled).
    pub total: u64,
    pub withdrawn: u64,
    pub start: i64,
    pub cliff: i64,
    pub end: i64,
    pub bump: u8,
    pub cancellable: bool,
}

impl Timelock {
    /// Seeds the timelock PDA signs with. `seed` and `bump` must outlive the returned array.
    pub fn signer_seeds<'a>(&'a self, seed: &'a [u8; 8], bump: &'a [u8; 1]) -> [&'a [u8]; 5] {
        [TIMELOCK_SEED, self.sender.as_ref(), self.recipient.as_ref(), seed, bump]
    }
}
