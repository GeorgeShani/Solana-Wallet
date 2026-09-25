import { describe, expect, test } from 'bun:test'
import { getTransactionDecoder } from '@solana/transactions'
import { post, RICH, setup } from '../../shared/testApp'
import { createRateLimiter } from '../../shared/rateLimit'
import { buildTx, claimFixtures, newSigner } from '../../shared/testUtils'
import { MIN_RELAYER_LAMPORTS } from './relay.routes'

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
