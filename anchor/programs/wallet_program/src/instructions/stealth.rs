//! Stealth-address announcements.
//!
//! A stealth payment goes to a one-time address that only the recipient can find and spend from
//! (see packages/shared/src/stealth.ts for the cryptography). To let the recipient find it, the
//! sender publishes the ephemeral public key they used, alongside the payment. This instruction
//! does nothing except emit that as an event, which our backend indexes and the recipient's
//! wallet scans. It stores nothing, and deliberately does not record who the sender is.

use anchor_lang::prelude::*;

#[event]
pub struct StealthAnnouncement {
    /// The sender's ephemeral public key `R = r·G` (a compressed Edwards point, 32 bytes).
    pub ephemeral: Pubkey,
    /// The one-time address that was paid.
    pub stealth: Pubkey,
    /// First byte of a hash of the shared secret. Lets a wallet skip ~99.6% of announcements
    /// after one cheap comparison instead of doing the full derivation for each.
    pub view_tag: u8,
}

#[derive(Accounts)]
pub struct Announce<'info> {
    /// Required so an announcement can't be produced without paying a transaction fee.
    pub payer: Signer<'info>,
}

pub fn handle_announce(_ctx: Context<Announce>, ephemeral: Pubkey, stealth: Pubkey, view_tag: u8) -> Result<()> {
    emit!(StealthAnnouncement { ephemeral, stealth, view_tag });
    Ok(())
}
