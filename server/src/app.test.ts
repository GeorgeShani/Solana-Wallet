import { describe, expect, test } from 'bun:test'
import { address, type Address } from '@solana/addresses'
import { partiallySignTransaction, getTransactionDecoder } from '@solana/transactions'
import { createApp, type Deps } from './app'
import { createAnnouncementStore, createFaucetStore, openDatabase } from './db'
import { createIndexer } from './announcements'
import { createRateLimiter } from './rateLimit'
import { MIN_RELAYER_LAMPORTS } from './routes/relay'
import { buildTx, claimFixtures, newSigner } from './testUtils'
import type { Chain, Minter, Relayer } from './types'

const ORIGIN = 'http://localhost:5173'
const RICH = 10_000_000_000n

async function setup(overrides: Partial<Deps> & { balance?: bigint; minterDelay?: Promise<void> } = {}) {
  const signer = await newSigner()
  const sent: string[] = []
  const minted: { recipient: Address; amounts: string[] }[] = []
  const chain: Chain = {
    sendTransaction: async (b64) => {
      sent.push(b64)
      return 'FakeSignature1111111111111111111111111111111111'
    },
    getBalance: async () => overrides.balance ?? RICH,
    confirm: async () => {},
  }
  const relayer: Relayer = {
    address: signer.address,
    sign: (tx) => partiallySignTransaction([signer.keyPair], tx as Parameters<typeof partiallySignTransaction>[1]),
  }
  const minter: Minter = {
    address: signer.address,
    mintTokens: async (recipient, drops) => {
      await overrides.minterDelay
      minted.push({ recipient, amounts: drops.map((d) => d.amount.toString()) })
      return 'MintSignature11111111111111111111111111111111111'
    },
  }
  let clock = 1_000_000_000_000
  const db = openDatabase(':memory:')
  const announcementStore = createAnnouncementStore(db)
  const app = createApp({
    corsOrigins: [ORIGIN],
    chain,
    relayer,
    minter,
    faucetStore: createFaucetStore(db),
    announcements: {
      store: announcementStore,
      indexer: createIndexer({ store: announcementStore, source: { listSignatures: async () => [], getLogs: async () => null } }),
    },
    prices: { get: async () => ({ solUsd: 150.25, updatedAt: 1, stale: false }) },
    now: () => clock,
    ...overrides,
  })
  return { app, signer, sent, minted, advance: (ms: number) => (clock += ms) }
}

const post = (app: { request: (u: string, i?: RequestInit) => Response | Promise<Response> }, path: string, body: unknown, ip = '1.1.1.1') =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

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

describe('POST /relay', () => {
  test('signs an approved claim as fee payer and broadcasts it', async () => {
    const { app, signer, sent } = await setup()
    const f = await claimFixtures()
    const { base64 } = await buildTx({ feePayer: signer.address, instructions: [f.sol], signers: [f.claimKey] })

    const res = await post(app, '/relay', { transaction: base64 })
    expect(res.status).toBe(200)
    expect((await res.json()).signature).toBe('FakeSignature1111111111111111111111111111111111')

    // what was broadcast carries BOTH signatures: the claim key's and the relayer's
    expect(sent).toHaveLength(1)
    const tx = getTransactionDecoder().decode(Uint8Array.from(atob(sent[0]), (c) => c.charCodeAt(0)))
    expect(tx.signatures[signer.address]).toBeTruthy()
    expect(tx.signatures[f.claimKey.address]).toBeTruthy()
  })

  test('refuses anything the policy rejects, without broadcasting', async () => {
    const { app, signer, sent } = await setup()
    const thief = await newSigner()
    const { systemTransfer } = await import('@wallet/program-client')
    const { base64 } = await buildTx({
      feePayer: signer.address,
      instructions: [systemTransfer({ from: signer.address, to: thief.address, lamports: 1_000_000_000n })],
    })
    const res = await post(app, '/relay', { transaction: base64 })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('is not allowed')
    expect(sent).toHaveLength(0)
  })

  test('validates the request body', async () => {
    const { app } = await setup()
    expect((await post(app, '/relay', 'not json')).status).toBe(400)
    expect((await post(app, '/relay', {})).status).toBe(400)
    expect((await post(app, '/relay', { transaction: 42 })).status).toBe(400)
    expect((await post(app, '/relay', { transaction: '!!!not base64!!!' })).status).toBe(400)
    expect((await post(app, '/relay', { transaction: 'A'.repeat(5000) })).status).toBe(400)
  })

  test('rate-limits per IP', async () => {
    const { app } = await setup({ limiters: { relay: createRateLimiter({ windowMs: 60_000, max: 2 }) } })
    expect((await post(app, '/relay', {}, '9.9.9.9')).status).toBe(400)
    expect((await post(app, '/relay', {}, '9.9.9.9')).status).toBe(400)
    const limited = await post(app, '/relay', {}, '9.9.9.9')
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    // another IP is unaffected
    expect((await post(app, '/relay', {}, '8.8.8.8')).status).toBe(400)
  })

  test('stops when the relayer is nearly out of SOL', async () => {
    const { app, signer, sent } = await setup({ balance: MIN_RELAYER_LAMPORTS - 1n })
    const f = await claimFixtures()
    const { base64 } = await buildTx({ feePayer: signer.address, instructions: [f.sol], signers: [f.claimKey] })
    expect((await post(app, '/relay', { transaction: base64 })).status).toBe(503)
    expect(sent).toHaveLength(0)
  })

  test('reports a failed simulation (e.g. already claimed) as a 400', async () => {
    const { app, signer } = await setup({
      chain: {
        sendTransaction: async () => {
          throw new Error('Transaction simulation failed: custom program error: #3012')
        },
        getBalance: async () => RICH,
        confirm: async () => {},
      },
    })
    const f = await claimFixtures()
    const { base64 } = await buildTx({ feePayer: signer.address, instructions: [f.sol], signers: [f.claimKey] })
    const res = await post(app, '/relay', { transaction: base64 })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('simulation failed')
  })
})

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
