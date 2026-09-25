import { describe, expect, test } from 'bun:test'
import { createRateLimiter } from './rateLimit'

describe('rate limiter', () => {
  test('allows up to max hits per window, then reports when to retry', () => {
    let t = 0
    const rl = createRateLimiter({ windowMs: 1_000, max: 2, now: () => t })
    expect(rl.hit('a')).toEqual({ ok: true })
    t = 100
    expect(rl.hit('a')).toEqual({ ok: true })
    t = 200
    expect(rl.hit('a')).toEqual({ ok: false, retryAfterMs: 800 })
    expect(rl.hit('b')).toEqual({ ok: true }) // separate keys
    t = 1_001
    expect(rl.hit('a')).toEqual({ ok: true }) // the first hit aged out
  })
})
