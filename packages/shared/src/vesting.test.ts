import { describe, expect, test } from 'bun:test'
import { vestedAmount, withdrawableAmount } from './vesting'

// Same vectors as the Rust unit tests in math.rs.
describe('vesting math (matches the Rust program)', () => {
  test('linear between start and end', () => {
    const v = (now: bigint) => vestedAmount(1_000n, 100n, 100n, 1_100n, now)
    expect([v(99n), v(100n), v(350n), v(600n), v(1_099n), v(1_100n), v(99_999n)]).toEqual([
      0n, 0n, 250n, 500n, 999n, 1_000n, 1_000n,
    ])
  })

  test('a cliff holds everything back, then releases the accrued share', () => {
    const v = (now: bigint) => vestedAmount(1_000n, 0n, 400n, 1_000n, now)
    expect([v(399n), v(400n), v(700n)]).toEqual([0n, 400n, 700n])
  })

  test('unlock on a date is all or nothing', () => {
    const v = (now: bigint) => vestedAmount(5_000n, 777n, 777n, 777n, now)
    expect([v(776n), v(777n), v(1_000_000n)]).toEqual([0n, 5_000n, 5_000n])
  })

  test('never exceeds the total or decreases', () => {
    let last = 0n
    for (let now = 0n; now <= 2_000n; now += 7n) {
      const v = vestedAmount(2n ** 64n - 1n, 100n, 300n, 1_900n, now)
      expect(v >= last).toBe(true)
      last = v
    }
    expect(last).toBe(2n ** 64n - 1n)
  })

  test('withdrawable subtracts what was already taken', () => {
    const t = { total: 1_000n, withdrawn: 250n, start: 0n, cliff: 0n, end: 1_000n }
    expect(withdrawableAmount(t, 400n)).toBe(150n)
    expect(withdrawableAmount(t, 200n)).toBe(0n) // vested 200 < already withdrawn 250
    expect(withdrawableAmount(t, 5_000n)).toBe(750n)
  })
})
