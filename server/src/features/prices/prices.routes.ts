import { Hono } from 'hono'
import type { PriceService } from './prices.service'

/** GET /prices: the SOL/USD price, for display only. */
export function priceRoutes(deps: { prices: PriceService }) {
  const app = new Hono()
  app.get('/', async (c) => c.json(await deps.prices.get()))
  return app
}
