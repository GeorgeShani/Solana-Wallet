use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Mints must be passed in sorted order (mint_a < mint_b)")]
    UnsortedMints,
    #[msg("Swap fee is above the maximum allowed")]
    InvalidFee,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[msg("Pool does not have enough liquidity for this trade")]
    InsufficientLiquidity,
    #[msg("The first deposit is too small")]
    InitialDepositTooSmall,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("This link has expired and can no longer be claimed")]
    ClaimExpired,
    #[msg("Expiry must be in the future")]
    InvalidExpiry,
    #[msg("Amount is below the minimum for a SOL link")]
    AmountTooSmall,
    #[msg("This link holds a different kind of asset")]
    LinkTypeMismatch,
    #[msg("Schedule must satisfy start <= cliff <= end, with the end in the future")]
    InvalidSchedule,
    #[msg("Nothing has vested yet, or everything vested was already withdrawn")]
    NothingToWithdraw,
    #[msg("This timelock was created as non-cancellable")]
    NotCancellable,
}
