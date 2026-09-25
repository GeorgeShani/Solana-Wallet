import { describe, expect, test } from 'bun:test'
import { address } from '@solana/addresses'
import { post, setup } from '../../shared/testApp'
import { createRateLimiter } from '../../shared/rateLimit'
import { newSigner } from '../../shared/testUtils'

describe('POST /faucet', () => {
  const A = address('5PgQWusbALXk1PcrPC1BVuXV87R25Rhryu9HsmJvipP4')
  const B = address('141GfzLBSYp2qBEtqdBfJ9P3FGK99twsu6NLaE8y5z2i')

  test('lists what one claim gives', async () => {
    const { app } = await setup()
    const info = await (await app.request('/faucet/info')).json()
    expect(info.cooldownHours).toBe(24)
    expect(info.tokens).toEqual([
      { symbol: 'tUSDC', amount: '100000000', decimals: 6 },
      { symbol: 'tBONK', amount: '100000000000', decimals: 5 },
    ])
  })

  test('mints the test tokens to the address', async () => {
    const { app, minted } = await setup()
    const res = await post(app, '/faucet', { address: A })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.signature).toBe('MintSignature11111111111111111111111111111111111')
    expect(body.tokens.map((t: { symbol: string }) => t.symbol)).toEqual(['tUSDC', 'tBONK'])
    expect(minted).toEqual([{ recipient: A, amounts: ['100000000', '100000000000'] }])
  })

  test('one claim per address per day, then again after the cooldown', async () => {
    const { app, minted, advance } = await setup()
    expect((await post(app, '/faucet', { address: A })).status).toBe(200)
    const again = await post(app, '/faucet', { address: A })
    expect(again.status).toBe(429)
    expect((await again.json()).retryAfterSeconds).toBeGreaterThan(0)
    expect(minted).toHaveLength(1)

    expect((await post(app, '/faucet', { address: B })).status).toBe(200) // a different address is fine
    advance(24 * 60 * 60 * 1000 + 1)
    expect((await post(app, '/faucet', { address: A })).status).toBe(200)
  })

  test('caps claims per IP, so one person cannot farm many addresses', async () => {
    const { app } = await setup({ limiters: { faucet: createRateLimiter({ windowMs: 60_000, max: 100 }) } })
    for (let i = 0; i < 5; i++) {
      const fresh = (await newSigner()).address
      expect((await post(app, '/faucet', { address: fresh }, '4.4.4.4')).status).toBe(200)
    }
    const sixth = (await newSigner()).address
    expect((await post(app, '/faucet', { address: sixth }, '4.4.4.4')).status).toBe(429)
    expect((await post(app, '/faucet', { address: sixth }, '5.5.5.5')).status).toBe(200)
  })

  test('validates the address', async () => {
    const { app, minted } = await setup()
    for (const body of [{}, { address: 'nope' }, { address: 123 }, 'not json']) {
      expect((await post(app, '/faucet', body)).status).toBe(400)
    }
    expect(minted).toHaveLength(0)
  })

  test('a second simultaneous request for the same address is refused', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { app, minted } = await setup({ minterDelay: gate })
    const first = post(app, '/faucet', { address: A })
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 20))
    expect((await post(app, '/faucet', { address: A }, '2.2.2.2')).status).toBe(429)
    release()
    expect((await first).status).toBe(200)
    expect(minted).toHaveLength(1)
  })

  test('stops when the server wallet is nearly out of SOL', async () => {
    const { app, minted } = await setup({ balance: 1_000_000n })
    expect((await post(app, '/faucet', { address: A })).status).toBe(503)
    expect(minted).toHaveLength(0)
  })

  test('a failed mint does not use up the address’s daily claim', async () => {
    const { app } = await setup({
      minter: {
        address: address('11111111111111111111111111111112'),
        mintTokens: async () => {
          throw new Error('rpc down')
        },
      },
    })
    expect((await post(app, '/faucet', { address: A })).status).toBe(500)
    // (the store is only written after success, so a retry is allowed)
    expect((await post(app, '/faucet', { address: A })).status).toBe(500)
  })
})
