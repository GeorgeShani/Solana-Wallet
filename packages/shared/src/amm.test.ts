import { describe, expect, test } from 'bun:test'
import { isqrt, minAmountOut, priceImpactBps, quoteAdd, quoteRemove, swapOutput } from './amm'

// These vectors mirror the Rust unit tests (anchor/programs/wallet_program/src/math.rs)
// and the LiteSVM integration tests, so the UI quote and the on-chain result can't drift.
describe('amm math (matches the Rust program)', () => {
  test('isqrt', () => {
    for (let n = 0n; n < 2000n; n++) {
      const r = isqrt(n)
      expect(r * r <= n && (r + 1n) * (r + 1n) > n).toBe(true)
    }
    expect(isqrt((2n ** 64n - 1n) ** 2n)).toBe(2n ** 64n - 1n)
  })

  test('swapOutput: Uniswap V2 reference numbers', () => {
    expect(swapOutput(1_000_000n, 1_000_000n, 10_000n, 30)).toBe(9_871n)
    // the exact figure asserted by the on-chain integration test
    expect(swapOutput(1_000_000_000n, 1_000_000_000n, 10_000_000n, 30)).toBe(9_871_580n)
  })

  test('swapOutput never drains the pool and k never shrinks', () => {
    for (const fee of [0, 30, 1000]) {
      for (const amountIn of [1n, 7n, 1_000n, 999_999n, 1_000_000_000n, 10n ** 14n]) {
        const [ri, ro] = [5_000_000n, 3_000_000n]
        const out = swapOutput(ri, ro, amountIn, fee)
        expect(out < ro).toBe(true)
        expect((ri + amountIn) * (ro - out) >= ri * ro).toBe(true)
      }
    }
  })

  test('swapOutput rejects bad input', () => {
    expect(() => swapOutput(100n, 100n, 0n, 30)).toThrow()
    expect(() => swapOutput(0n, 100n, 5n, 30)).toThrow()
    expect(() => swapOutput(100n, 0n, 5n, 30)).toThrow()
  })

  test('quoteAdd: first deposit locks the minimum liquidity', () => {
    expect(quoteAdd(0n, 0n, 0n, 4_000_000n, 1_000_000n)).toEqual({
      amountA: 4_000_000n,
      amountB: 1_000_000n,
      lp: 1_999_000n,
    })
    expect(() => quoteAdd(0n, 0n, 0n, 100n, 100n)).toThrow()
  })

  test('quoteAdd: later deposits keep the pool ratio', () => {
    const q = quoteAdd(4_000_000n, 1_000_000n, 1_999_000n, 400_000n, 999_999n)
    expect([q.amountA, q.amountB, q.lp]).toEqual([400_000n, 100_000n, 200_000n])
    const r = quoteAdd(4_000_000n, 1_000_000n, 1_999_000n, 999_999n, 50_000n)
    expect([r.amountA, r.amountB]).toEqual([200_000n, 50_000n])
  })

  test('quoteRemove is proportional', () => {
    expect(quoteRemove(4_000_000n, 1_000_000n, 1_999_000n, 200_000n)).toEqual({
      amountA: 400_000n,
      amountB: 100_000n,
    })
  })

  test('priceImpactBps and minAmountOut', () => {
    // a trade of 0.01% of the pool: impact is essentially just the 0.3% fee (30 bps)
    const out = swapOutput(1_000_000_000n, 1_000_000_000n, 100_000n, 30)
    const tiny = priceImpactBps(1_000_000_000n, 1_000_000_000n, 100_000n, out)
    expect(tiny).toBeGreaterThanOrEqual(30)
    expect(tiny).toBeLessThanOrEqual(32)
    // 0.1% of the pool adds ~10 bps of real curve slippage on top of the fee
    const small = swapOutput(1_000_000_000n, 1_000_000_000n, 1_000_000n, 30)
    expect(priceImpactBps(1_000_000_000n, 1_000_000_000n, 1_000_000n, small)).toBe(39)
    // a 10% of the pool trade moves the price a lot more
    const big = swapOutput(1_000_000_000n, 1_000_000_000n, 100_000_000n, 30)
    expect(priceImpactBps(1_000_000_000n, 1_000_000_000n, 100_000_000n, big)).toBeGreaterThan(900)
    expect(minAmountOut(1_000_000n, 50)).toBe(995_000n) // 0.5% slippage
    expect(minAmountOut(1_000_000n, 0)).toBe(1_000_000n)
  })
})
