import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Chain, Minter, Relayer } from './chain/types'
import { announcementRoutes, type AnnouncementStore, type Indexer } from './features/announcements'
import { faucetRoutes, type FaucetStore } from './features/faucet'
import { nftRoutes, type NftStore } from './features/nft'
import { priceRoutes, type PriceService } from './features/prices'
import { relayRoutes } from './features/relay'
import { clientIp } from './shared/http'
import { createRateLimiter, type RateLimiter } from './shared/rateLimit'

export interface Deps {
  corsOrigins: string[]
  chain: Chain
  relayer: Relayer
  minter: Minter
  faucetStore: FaucetStore
  prices: PriceService
  announcements: { store: AnnouncementStore; indexer: Indexer }
  nft: { store: NftStore; publicUrl: string }
  /** Override the default limits (tests). */
  limiters?: { relay?: RateLimiter; faucet?: RateLimiter; announcements?: RateLimiter; nft?: RateLimiter }
  now?: () => number
}

/** Assembles the API: each feature owns its routes, this only mounts them and adds the shared rules. */
export function createApp(deps: Deps) {
  const app = new Hono()
  app.use('*', cors({ origin: deps.corsOrigins, allowMethods: ['GET', 'POST', 'OPTIONS'] }))

  app.get('/health', (c) => c.json({ ok: true, wallet: deps.minter.address }))

  app.route('/prices', priceRoutes({ prices: deps.prices }))
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
  app.route(
    '/nft',
    nftRoutes({
      store: deps.nft.store,
      publicUrl: deps.nft.publicUrl,
      limiter: deps.limiters?.nft ?? createRateLimiter({ windowMs: 60_000, max: 6 }),
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
