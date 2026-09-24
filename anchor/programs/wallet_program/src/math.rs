//! Pure pool arithmetic (no account handling), so it can be unit-tested directly.
//! All intermediate math is done in u128 with checked operations.

use anchor_lang::prelude::*;

use crate::{constants::*, error::ErrorCode};

/// Floor of the square root of `n` (Babylonian method, as used by Uniswap V2).
pub fn isqrt(n: u128) -> u128 {
    if n < 4 {
        return if n == 0 { 0 } else { 1 };
    }
    let mut z = n;
    let mut x = n / 2 + 1;
    while x < z {
        z = x;
        x = (n / x + x) / 2;
    }
    z
}

/// Constant-product swap: how much of the output token `amount_in` buys.
///
/// The fee is taken from the input, so `amount_in * (1 - fee)` moves the price along
/// `x * y = k` and the fee stays in the pool. Rounds down (in the pool's favour).
pub fn swap_output(reserve_in: u64, reserve_out: u64, amount_in: u64, fee_bps: u16) -> Result<u64> {
    require!(amount_in > 0, ErrorCode::ZeroAmount);
    require!(reserve_in > 0 && reserve_out > 0, ErrorCode::InsufficientLiquidity);

    let fee_multiplier = FEE_DENOMINATOR
        .checked_sub(fee_bps as u64)
        .ok_or(ErrorCode::InvalidFee)? as u128;
    let in_with_fee = (amount_in as u128)
        .checked_mul(fee_multiplier)
        .ok_or(ErrorCode::MathOverflow)?;
    let numerator = in_with_fee
        .checked_mul(reserve_out as u128)
        .ok_or(ErrorCode::MathOverflow)?;
    let denominator = (reserve_in as u128)
        .checked_mul(FEE_DENOMINATOR as u128)
        .and_then(|d| d.checked_add(in_with_fee))
        .ok_or(ErrorCode::MathOverflow)?;

    u64::try_from(numerator / denominator).map_err(|_| error!(ErrorCode::MathOverflow))
}

#[derive(Debug, PartialEq, Eq)]
pub struct AddQuote {
    pub amount_a: u64,
    pub amount_b: u64,
    /// LP tokens minted to the depositor.
    pub lp: u64,
}

/// How much of each token a deposit actually takes, and the LP tokens it earns.
///
/// The user says the most they are willing to add of each token; the pool takes the
/// largest amounts in its current ratio that fit within both limits.
pub fn quote_add(
    reserve_a: u64,
    reserve_b: u64,
    lp_supply: u64,
    want_a: u64,
    want_b: u64,
) -> Result<AddQuote> {
    require!(want_a > 0 && want_b > 0, ErrorCode::ZeroAmount);

    if reserve_a == 0 && reserve_b == 0 {
        // First deposit sets the price. MINIMUM_LIQUIDITY shares are locked forever.
        let shares = isqrt((want_a as u128) * (want_b as u128));
        require!(shares > MINIMUM_LIQUIDITY as u128, ErrorCode::InitialDepositTooSmall);
        return Ok(AddQuote {
            amount_a: want_a,
            amount_b: want_b,
            lp: (shares - MINIMUM_LIQUIDITY as u128) as u64,
        });
    }
    require!(reserve_a > 0 && reserve_b > 0, ErrorCode::InsufficientLiquidity);

    // Locked shares still count towards the total, so they never dilute anyone.
    let total_shares = (lp_supply as u128) + (MINIMUM_LIQUIDITY as u128);
    let (ra, rb) = (reserve_a as u128, reserve_b as u128);
    let mul = |x: u128, y: u128| x.checked_mul(y).ok_or(ErrorCode::MathOverflow);

    let b_for_all_a = mul(want_a as u128, rb)? / ra;
    let (a, b) = if b_for_all_a <= want_b as u128 {
        (want_a as u128, b_for_all_a)
    } else {
        (mul(want_b as u128, ra)? / rb, want_b as u128)
    };
    require!(a > 0 && b > 0, ErrorCode::ZeroAmount);

    let lp = (mul(a, total_shares)? / ra).min(mul(b, total_shares)? / rb);
    require!(lp > 0, ErrorCode::ZeroAmount);

    Ok(AddQuote {
        amount_a: a as u64,
        amount_b: b as u64,
        lp: u64::try_from(lp).map_err(|_| error!(ErrorCode::MathOverflow))?,
    })
}

/// Tokens returned for burning `lp_amount` shares (rounds down).
pub fn quote_remove(
    reserve_a: u64,
    reserve_b: u64,
    lp_supply: u64,
    lp_amount: u64,
) -> Result<(u64, u64)> {
    require!(lp_amount > 0, ErrorCode::ZeroAmount);
    let total_shares = (lp_supply as u128) + (MINIMUM_LIQUIDITY as u128);
    let share = |reserve: u64| -> Result<u64> {
        let v = (lp_amount as u128)
            .checked_mul(reserve as u128)
            .ok_or(ErrorCode::MathOverflow)?
            / total_shares;
        u64::try_from(v).map_err(|_| error!(ErrorCode::MathOverflow))
    };
    Ok((share(reserve_a)?, share(reserve_b)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn isqrt_matches_floor_sqrt() {
        for n in 0u128..2_000 {
            let r = isqrt(n);
            assert!(r * r <= n && (r + 1) * (r + 1) > n, "isqrt({n}) = {r}");
        }
        assert_eq!(isqrt(u64::MAX as u128 * u64::MAX as u128), u64::MAX as u128);
    }

    #[test]
    fn swap_output_matches_uniswap_v2_example() {
        // 1_000_000 / 1_000_000 pool, 0.3% fee, swap 10_000 in:
        // 10_000 * 9970 * 1_000_000 / (1_000_000 * 10_000 + 10_000 * 9970) = 9_871
        assert_eq!(swap_output(1_000_000, 1_000_000, 10_000, 30).unwrap(), 9_871);
    }

    #[test]
    fn swap_never_drains_the_pool_and_k_never_decreases() {
        for fee in [0u16, 30, 1_000] {
            for amount_in in [1u64, 7, 1_000, 999_999, 1_000_000_000, u64::MAX / 100_000] {
                let (ri, ro) = (5_000_000u64, 3_000_000u64);
                let out = swap_output(ri, ro, amount_in, fee).unwrap();
                assert!(out < ro);
                let k_before = ri as u128 * ro as u128;
                let k_after = (ri as u128 + amount_in as u128) * (ro as u128 - out as u128);
                assert!(k_after >= k_before, "k shrank for fee={fee} in={amount_in}");
            }
        }
    }

    #[test]
    fn swap_rejects_bad_input() {
        assert!(swap_output(100, 100, 0, 30).is_err());
        assert!(swap_output(0, 100, 5, 30).is_err());
        assert!(swap_output(100, 0, 5, 30).is_err());
        // in_with_fee * reserve_out exceeds u128: must be a clean error, not a panic
        assert!(swap_output(u64::MAX, u64::MAX, u64::MAX, 30).is_err());
    }

    #[test]
    fn first_deposit_locks_minimum_liquidity() {
        let q = quote_add(0, 0, 0, 4_000_000, 1_000_000).unwrap();
        // sqrt(4e6 * 1e6) = 2_000_000, minus the locked 1_000
        assert_eq!(q, AddQuote { amount_a: 4_000_000, amount_b: 1_000_000, lp: 1_999_000 });
        assert!(quote_add(0, 0, 0, 100, 100).is_err()); // sqrt = 100 <= 1_000
    }

    #[test]
    fn later_deposits_keep_the_pool_ratio() {
        // pool 4:1, supply 1_999_000 (+1_000 locked = 2_000_000 shares)
        let q = quote_add(4_000_000, 1_000_000, 1_999_000, 400_000, 999_999).unwrap();
        assert_eq!((q.amount_a, q.amount_b), (400_000, 100_000)); // b is the spare side
        assert_eq!(q.lp, 200_000); // 10% of the pool
        // b-limited
        let q = quote_add(4_000_000, 1_000_000, 1_999_000, 999_999, 50_000).unwrap();
        assert_eq!((q.amount_a, q.amount_b), (200_000, 50_000));
    }

    #[test]
    fn remove_is_proportional() {
        let (a, b) = quote_remove(4_000_000, 1_000_000, 1_999_000, 200_000).unwrap();
        assert_eq!((a, b), (400_000, 100_000));
        assert!(quote_remove(1, 1, 1, 0).is_err());
    }

    #[test]
    fn deposit_then_withdraw_never_profits() {
        let (ra, rb, supply) = (7_777_777u64, 3_333_333u64, 5_000_000u64);
        let q = quote_add(ra, rb, supply, 123_457, 999_999).unwrap();
        let (a, b) = quote_remove(ra + q.amount_a, rb + q.amount_b, supply + q.lp, q.lp).unwrap();
        assert!(a <= q.amount_a && b <= q.amount_b);
    }
}
