import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { getConnInfo } from 'hono/bun'
import type { AnnouncementStore, Indexer } from './announcements'
import type { FaucetStore } from './db'
import type { PriceService } from './prices'
import { createRateLimiter, type RateLimiter } from './rateLimit'
import { announcementRoutes } from './routes/announcements'
import { faucetRoutes } from './routes/faucet'
import { relayRoutes } from './routes/relay'
import type { Chain, Minter, Relayer } from './types'

export interface Deps {
  corsOrigins: string[]
  chain: Chain
  relayer: Relayer
  minter: Minter
  faucetStore: FaucetStore
  prices: PriceService
  announcements: { store: AnnouncementStore; indexer: Indexer }
  /** Override the default limits (tests). */
  limiters?: { relay?: RateLimiter; faucet?: RateLimiter; announcements?: RateLimiter }
  now?: () => number
}

/** The caller's IP: the proxy's forwarded address if present, else the socket's. */
export function clientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
  if (forwarded) return forwarded
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown' // not running under Bun.serve (e.g. in tests)
  }
}

export function createApp(deps: Deps) {
  const app = new Hono()
  app.use('*', cors({ origin: deps.corsOrigins, allowMethods: ['GET', 'POST', 'OPTIONS'] }))

  app.get('/health', (c) => c.json({ ok: true, wallet: deps.minter.address }))
  app.get('/prices', async (c) => c.json(await deps.prices.get()))

  app.route(
    '/relay',
    relayRoutes({
      relayer: deps.relayer,
      chain: deps.chain,
      limiter: deps.limiters?.relay ?? createRateLimiter({ windowMs: 60_000, max: 20 }),
      clientIp,
    }),
  )
  app.route(
    '/faucet',
    faucetRoutes({
      minter: deps.minter,
      chain: deps.chain,
      store: deps.faucetStore,
      limiter: deps.limiters?.faucet ?? createRateLimiter({ windowMs: 60_000, max: 10 }),
      clientIp,
      now: deps.now,
    }),
  )

  app.route(
    '/announcements',
    announcementRoutes({
      store: deps.announcements.store,
      indexer: deps.announcements.indexer,
      limiter: deps.limiters?.announcements ?? createRateLimiter({ windowMs: 60_000, max: 60 }),
      clientIp,
    }),
  )

  app.notFound((c) => c.json({ error: 'Not found' }, 404))
  app.onError((e, c) => {
    console.error(e)
    return c.json({ error: 'Something went wrong on the server.' }, 500)
  })
  return app
}
