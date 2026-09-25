import { describe, expect, test } from 'bun:test'
import { openFaucetStore } from './faucet.store'

describe('faucet store', () => {
  test('tracks the latest claim per address and claims per IP', () => {
    const s = openFaucetStore(':memory:')
    expect(s.lastClaimAt('x')).toBeNull()
    s.record('x', '1.1.1.1', 100)
    s.record('x', '1.1.1.1', 200)
    s.record('y', '1.1.1.1', 300)
    expect(s.lastClaimAt('x')).toBe(200)
    expect(s.claimsByIpSince('1.1.1.1', 150)).toBe(2)
    expect(s.claimsByIpSince('1.1.1.1', 0)).toBe(3)
    expect(s.claimsByIpSince('2.2.2.2', 0)).toBe(0)
  })
})
