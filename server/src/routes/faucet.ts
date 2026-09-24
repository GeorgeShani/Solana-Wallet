import { address, isAddress, type Address } from '@solana/addresses'
import { DEVNET } from '@wallet/shared'
import { Hono, type Context } from 'hono'
import type { FaucetStore } from '../db'
import type { RateLimiter } from '../rateLimit'
import type { Chain, Minter } from '../types'

/** How much of each test token one claim gives (whole tokens). */
export const FAUCET_DROPS: Record<string, number> = { tUSDC: 100, tBONK: 1_000_000 }
const COOLDOWN_MS = 24 * 60 * 60 * 1000
const MAX_CLAIMS_PER_IP_PER_DAY = 5
/** The server wallet pays token-account rent (~0.0015 SOL each), so stop before it runs dry. */
const MIN_ADMIN_LAMPORTS = 20_000_000n

function drops() {
  return Object.entries(FAUCET_DROPS).flatMap(([symbol, whole]) => {
    const token = DEVNET.tokens.find((t) => t.symbol === symbol)
    return token ? [{ symbol, decimals: token.decimals, mint: address(token.mint), amount: BigInt(whole) * 10n ** BigInt(token.decimals) }] : []
  })
}

export function faucetRoutes(deps: {
  minter: Minter
  chain: Chain
  store: FaucetStore
  limiter: RateLimiter
  clientIp: (c: Context) => string
  now?: () => number
}) {
  const app = new Hono()
  const now = deps.now ?? Date.now
  const inFlight = new Set<string>()

  app.get('/info', (c) =>
    c.json({
      cooldownHours: COOLDOWN_MS / 3_600_000,
      tokens: drops().map((d) => ({ symbol: d.symbol, amount: d.amount.toString(), decimals: d.decimals })),
    }),
  )

  app.post('/', async (c) => {
    const ip = deps.clientIp(c)
    const limited = deps.limiter.hit(ip)
    if (!limited.ok) return c.json({ error: 'Too many requests. Please wait a moment.' }, 429)

    const body = (await c.req.json().catch(() => null)) as { address?: unknown } | null
    const to = typeof body?.address === 'string' ? body.address.trim() : ''
    if (!isAddress(to)) return c.json({ error: 'Enter a valid Solana address.' }, 400)

    const t = now()
    const last = deps.store.lastClaimAt(to)
    if (last !== null && t - last < COOLDOWN_MS) {
      const retryAfterSeconds = Math.ceil((COOLDOWN_MS - (t - last)) / 1000)
      return c.json({ error: 'This address already claimed test tokens today.', retryAfterSeconds }, 429)
    }
    if (deps.store.claimsByIpSince(ip, t - COOLDOWN_MS) >= MAX_CLAIMS_PER_IP_PER_DAY) {
      return c.json({ error: 'Too many claims from your network today.' }, 429)
    }
    if (inFlight.has(to)) return c.json({ error: 'A claim for this address is already in progress.' }, 429)

    if ((await deps.chain.getBalance(deps.minter.address)) < MIN_ADMIN_LAMPORTS) {
      return c.json({ error: 'The faucet is out of funds. Try again later.' }, 503)
    }

    inFlight.add(to)
    try {
      const list = drops()
      const signature = await deps.minter.mintTokens(to as Address, list.map(({ mint, amount }) => ({ mint, amount })))
      deps.store.record(to, ip, now())
      return c.json({
        signature,
        tokens: list.map((d) => ({ symbol: d.symbol, amount: d.amount.toString(), decimals: d.decimals })),
      })
    } finally {
      inFlight.delete(to)
    }
  })

  return app
}
