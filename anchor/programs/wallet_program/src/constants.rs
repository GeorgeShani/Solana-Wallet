use anchor_lang::prelude::*;

/// Seed for a pool PDA: ["pool", mint_a, mint_b].
#[constant]
pub const POOL_SEED: &[u8] = b"pool";

/// Seed for a pool's LP-token mint PDA: ["lp", pool].
#[constant]
pub const LP_MINT_SEED: &[u8] = b"lp";

/// Seed for a claim-link escrow PDA: ["claim", claim_key].
#[constant]
pub const CLAIM_SEED: &[u8] = b"claim";

/// Fees are expressed in basis points (1 bp = 0.01%).
#[constant]
pub const FEE_DENOMINATOR: u64 = 10_000;

/// Highest swap fee a pool may be created with (10%).
#[constant]
pub const MAX_FEE_BPS: u16 = 1_000;

/// LP shares permanently locked in the pool by the first deposit. This stops the
/// classic "inflate the share price" attack on an empty pool (same idea as Uniswap V2).
#[constant]
pub const MINIMUM_LIQUIDITY: u64 = 1_000;

#[constant]
pub const LP_DECIMALS: u8 = 9;
