import { describe, expect, test } from 'bun:test'
import { ORIGIN, setup } from './shared/testApp'

describe('basic routes', () => {
  test('health, prices, relay info and 404', async () => {
    const { app, signer } = await setup()
    expect(await (await app.request('/health')).json()).toEqual({ ok: true, wallet: signer.address })
    expect(await (await app.request('/prices')).json()).toEqual({ solUsd: 150.25, updatedAt: 1, stale: false })
    expect(await (await app.request('/relay/info')).json()).toEqual({ feePayer: signer.address })
    expect((await app.request('/nope')).status).toBe(404)
  })

  test('CORS allows the web app origin and nobody else', async () => {
    const { app } = await setup()
    const ok = await app.request('/health', { headers: { origin: ORIGIN } })
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    const bad = await app.request('/health', { headers: { origin: 'https://evil.example' } })
    expect(bad.headers.get('access-control-allow-origin')).toBeNull()
  })
})
