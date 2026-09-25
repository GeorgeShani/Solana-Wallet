import { Hono, type Context } from 'hono'
import type { AnnouncementStore, Indexer } from './announcements.types'
import type { RateLimiter } from '../../shared/rateLimit'

const MAX_LIMIT = 1_000

/**
 * The public feed of stealth-payment announcements. Every client downloads the same feed and
 * checks it locally against its own keys, so this server never learns who a payment is for.
 */
export function announcementRoutes(deps: {
  store: AnnouncementStore
  indexer: Indexer
  limiter: RateLimiter
  clientIp: (c: Context) => string
}) {
  const app = new Hono()

  app.get('/', async (c) => {
    if (!deps.limiter.hit(deps.clientIp(c)).ok) return c.json({ error: 'Too many requests.' }, 429)

    const after = Number(c.req.query('after') ?? 0)
    const limit = Number(c.req.query('limit') ?? 500)
    if (!Number.isInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1) {
      return c.json({ error: '"after" and "limit" must be positive whole numbers' }, 400)
    }

    await deps.indexer.refresh() // never throws: on failure we serve what we already have
    const items = deps.store.since(after, Math.min(limit, MAX_LIMIT))
    return c.json({ items, latestId: deps.store.latestId() })
  })

  return app
}
