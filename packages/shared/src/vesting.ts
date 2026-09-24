// TypeScript port of `vested_amount` in anchor/programs/wallet_program/src/math.rs.
// The UI uses it to show how much of a timelock can be withdrawn right now; the program
// recomputes the same number on-chain. vesting.test.ts checks the same vectors as the Rust tests.

/**
 * How much of `total` has vested at `now` (all values are unix seconds / base units).
 * Nothing before `cliff`, everything from `end`, and a straight line from `start` to `end`
 * in between, so at the cliff the recipient can take the share that accrued since `start`.
 * Requires start <= cliff <= end.
 */
export function vestedAmount(total: bigint, start: bigint, cliff: bigint, end: bigint, now: bigint): bigint {
  if (now < cliff) return 0n
  if (now >= end) return total
  return (total * (now - start)) / (end - start)
}

/** What the recipient could withdraw right now. */
export function withdrawableAmount(
  t: { total: bigint; withdrawn: bigint; start: bigint; cliff: bigint; end: bigint },
  now: bigint,
): bigint {
  const vested = vestedAmount(t.total, t.start, t.cliff, t.end, now)
  return vested > t.withdrawn ? vested - t.withdrawn : 0n
}
