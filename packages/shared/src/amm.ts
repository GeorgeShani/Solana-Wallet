// TypeScript port of anchor/programs/wallet_program/src/math.rs.
// The UI uses it to quote trades; the program re-computes the same numbers on-chain.
// Keep both in sync: amm.test.ts checks the same vectors as the Rust unit tests.

export const FEE_DENOMINATOR = 10_000n
export const MINIMUM_LIQUIDITY = 1_000n

export class AmmError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AmmError'
  }
}

/** Floor of the square root of n. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new AmmError('isqrt of a negative number')
  if (n < 4n) return n === 0n ? 0n : 1n
  let z = n
  let x = n / 2n + 1n
  while (x < z) {
    z = x
    x = (n / x + x) / 2n
  }
  return z
}

/** Output amount for swapping `amountIn` (fee taken from the input; rounds down). */
export function swapOutput(reserveIn: bigint, reserveOut: bigint, amountIn: bigint, feeBps: number): bigint {
  if (amountIn <= 0n) throw new AmmError('Amount must be greater than zero')
  if (reserveIn <= 0n || reserveOut <= 0n) throw new AmmError('Pool has no liquidity')
  const inWithFee = amountIn * (FEE_DENOMINATOR - BigInt(feeBps))
  return (inWithFee * reserveOut) / (reserveIn * FEE_DENOMINATOR + inWithFee)
}

/**
 * How far the trade moves the price against you, in basis points, compared to the
 * pool's current spot price (fee included, so it is never negative).
 */
export function priceImpactBps(reserveIn: bigint, reserveOut: bigint, amountIn: bigint, amountOut: bigint): number {
  // spot output = amountIn * reserveOut / reserveIn
  const spot = (amountIn * reserveOut) / reserveIn
  if (spot <= 0n) return 0
  const loss = spot > amountOut ? spot - amountOut : 0n
  return Number((loss * 10_000n) / spot)
}

/** Smallest output you'll accept given a slippage tolerance in basis points. */
export function minAmountOut(expectedOut: bigint, slippageBps: number): bigint {
  return (expectedOut * (FEE_DENOMINATOR - BigInt(slippageBps))) / FEE_DENOMINATOR
}

export interface AddQuote {
  amountA: bigint
  amountB: bigint
  lp: bigint
}

export function quoteAdd(
  reserveA: bigint,
  reserveB: bigint,
  lpSupply: bigint,
  wantA: bigint,
  wantB: bigint,
): AddQuote {
  if (wantA <= 0n || wantB <= 0n) throw new AmmError('Amount must be greater than zero')
  if (reserveA === 0n && reserveB === 0n) {
    const shares = isqrt(wantA * wantB)
    if (shares <= MINIMUM_LIQUIDITY) throw new AmmError('The first deposit is too small')
    return { amountA: wantA, amountB: wantB, lp: shares - MINIMUM_LIQUIDITY }
  }
  if (reserveA <= 0n || reserveB <= 0n) throw new AmmError('Pool has no liquidity')

  const total = lpSupply + MINIMUM_LIQUIDITY
  const bForAllA = (wantA * reserveB) / reserveA
  const [a, b] = bForAllA <= wantB ? [wantA, bForAllA] : [(wantB * reserveA) / reserveB, wantB]
  if (a <= 0n || b <= 0n) throw new AmmError('Amount must be greater than zero')
  const lpA = (a * total) / reserveA
  const lpB = (b * total) / reserveB
  const lp = lpA < lpB ? lpA : lpB
  if (lp <= 0n) throw new AmmError('Amount must be greater than zero')
  return { amountA: a, amountB: b, lp }
}

export function quoteRemove(
  reserveA: bigint,
  reserveB: bigint,
  lpSupply: bigint,
  lpAmount: bigint,
): { amountA: bigint; amountB: bigint } {
  if (lpAmount <= 0n) throw new AmmError('Amount must be greater than zero')
  const total = lpSupply + MINIMUM_LIQUIDITY
  return { amountA: (lpAmount * reserveA) / total, amountB: (lpAmount * reserveB) / total }
}
