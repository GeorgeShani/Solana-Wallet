import { describe, expect, test } from 'bun:test'
import { createPriceService } from './prices'
import { createRateLimiter } from './rateLimit'
import { openFaucetStore } from './db'

const ok = (usd: unknown) => async () => new Response(JSON.stringify({ solana: { usd } }), { status: 200 })

describe('price service', () => {
  test('fetches once and serves the cache within the TTL', async () => {
    let calls = 0
    let t = 1_000
    const svc = createPriceService({ ttlMs: 60_000, now: () => t, fetchImpl: (async () => (calls++, ok(151.5)())) as unknown as typeof fetch })
    expect(await svc.get()).toEqual({ solUsd: 151.5, updatedAt: 1_000, stale: false })
    t += 30_000
    await svc.get()
    expect(calls).toBe(1)
    t += 31_000 // past the TTL
    await svc.get()
    expect(calls).toBe(2)
  })

  test('serves the last good price (marked stale) when a refresh fails', async () => {
    let fail = false
    let t = 0
    const svc = createPriceService({
      ttlMs: 1_000,
      now: () => t,
      fetchImpl: (async () => (fail ? new Response('', { status: 500 }) : ok(140)())) as unknown as typeof fetch,
    })
    await svc.get()
    fail = true
    t = 5_000
    const r = await svc.get()
    expect(r.solUsd).toBe(140)
    expect(r.stale).toBe(true)
  })

  test('returns null when nothing has ever been fetched', async () => {
    const svc = createPriceService({ fetchImpl: (async () => new Response('', { status: 503 })) as unknown as typeof fetch })
    expect(await svc.get()).toEqual({ solUsd: null, updatedAt: null, stale: false })
  })

  test('rejects nonsense responses', async () => {
    for (const bad of ['abc', -1, 0, null, undefined]) {
      const svc = createPriceService({ fetchImpl: ok(bad) as unknown as typeof fetch })
      expect((await svc.get()).solUsd).toBeNull()
    }
  })

  test('concurrent callers share one request', async () => {
    let calls = 0
    const svc = createPriceService({ fetchImpl: (async () => (calls++, await new Promise((r) => setTimeout(r, 10)), ok(150)())) as unknown as typeof fetch })
    await Promise.all([svc.get(), svc.get(), svc.get()])
    expect(calls).toBe(1)
  })
})

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
