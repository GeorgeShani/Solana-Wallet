export interface Prices {
  /** SOL price in USD, or null if it could not be fetched and nothing is cached. */
  solUsd: number | null
  /** Unix ms when `solUsd` was fetched. */
  updatedAt: number | null
  /** True if the value is older than the cache lifetime because the latest fetch failed. */
  stale: boolean
}

export interface PriceService {
  get(): Promise<Prices>
}

const COINGECKO = 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'

/**
 * SOL/USD from CoinGecko, cached so the UI can poll freely. If a refresh fails, the last good
 * value is served (marked stale) instead of an error. Prices are for display only.
 */
export function createPriceService(opts: {
  ttlMs?: number
  fetchImpl?: typeof fetch
  now?: () => number
} = {}): PriceService {
  const ttl = opts.ttlMs ?? 60_000
  const doFetch = opts.fetchImpl ?? fetch
  const now = opts.now ?? Date.now
  let cached: { solUsd: number; at: number } | null = null
  let inflight: Promise<void> | null = null

  async function refresh() {
    try {
      const res = await doFetch(COINGECKO, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5_000) })
      if (!res.ok) throw new Error(`CoinGecko responded ${res.status}`)
      const body = (await res.json()) as { solana?: { usd?: unknown } }
      const usd = body.solana?.usd
      if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) throw new Error('Unexpected CoinGecko response')
      cached = { solUsd: usd, at: now() }
    } catch (e) {
      console.warn('Price refresh failed:', e instanceof Error ? e.message : e)
    }
  }

  return {
    async get() {
      if (!cached || now() - cached.at >= ttl) {
        inflight ??= refresh().finally(() => (inflight = null))
        await inflight
      }
      if (!cached) return { solUsd: null, updatedAt: null, stale: false }
      return { solUsd: cached.solUsd, updatedAt: cached.at, stale: now() - cached.at >= ttl }
    },
  }
}
