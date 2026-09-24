import { getBase64EncodedWireTransaction } from '@solana/transactions'
import { Hono, type Context } from 'hono'
import { checkRelayTransaction, MAX_TRANSACTION_BYTES } from '../relayPolicy'
import type { RateLimiter } from '../rateLimit'
import type { Chain, Relayer } from '../types'

/** Below this the relayer stops accepting work rather than fail mid-way (fees are ~0.00001 SOL). */
export const MIN_RELAYER_LAMPORTS = 5_000_000n

export function relayRoutes(deps: {
  relayer: Relayer
  chain: Chain
  limiter: RateLimiter
  clientIp: (c: Context) => string
}) {
  const app = new Hono()

  /** Who pays the fee. Clients set this as the transaction's fee payer before signing. */
  app.get('/info', (c) => c.json({ feePayer: deps.relayer.address }))

  app.post('/', async (c) => {
    const limited = deps.limiter.hit(deps.clientIp(c))
    if (!limited.ok) {
      c.header('Retry-After', String(Math.ceil(limited.retryAfterMs / 1000)))
      return c.json({ error: 'Too many requests. Please wait a moment and try again.' }, 429)
    }

    const body = (await c.req.json().catch(() => null)) as { transaction?: unknown } | null
    if (!body || typeof body.transaction !== 'string' || body.transaction.length > MAX_TRANSACTION_BYTES * 2) {
      return c.json({ error: 'Expected { "transaction": "<base64>" }' }, 400)
    }
    let wire: Uint8Array
    try {
      wire = Uint8Array.from(atob(body.transaction), (ch) => ch.charCodeAt(0))
    } catch {
      return c.json({ error: 'Transaction is not valid base64' }, 400)
    }

    const verdict = checkRelayTransaction(wire, deps.relayer.address)
    if (!verdict.ok) return c.json({ error: verdict.reason }, 400)

    if ((await deps.chain.getBalance(deps.relayer.address)) < MIN_RELAYER_LAMPORTS) {
      return c.json({ error: 'The fee relayer is out of funds. Try again later.' }, 503)
    }

    const signed = await deps.relayer.sign(verdict.transaction)
    try {
      const signature = await deps.chain.sendTransaction(getBase64EncodedWireTransaction(signed))
      return c.json({ signature })
    } catch (e) {
      // Preflight simulation failed (e.g. the link was already claimed): nothing was charged.
      const message = e instanceof Error ? e.message : String(e)
      return c.json({ error: message.length > 300 ? message.slice(0, 300) + '…' : message }, 400)
    }
  })

  return app
}
