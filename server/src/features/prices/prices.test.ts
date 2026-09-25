import { describe, expect, test } from 'bun:test'
import { createPriceService } from './prices.service'

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
