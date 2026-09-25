/** Sliding-window rate limiter kept in memory (one instance per process). */
export interface RateLimiter {
  /** Records a hit for `key`. Returns whether it is allowed and, if not, how long to wait. */
  hit(key: string): { ok: true } | { ok: false; retryAfterMs: number }
}

export function createRateLimiter(opts: { windowMs: number; max: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? Date.now
  const hits = new Map<string, number[]>()
  return {
    hit(key) {
      const t = now()
      const recent = (hits.get(key) ?? []).filter((at) => t - at < opts.windowMs)
      if (recent.length >= opts.max) {
        hits.set(key, recent)
        return { ok: false, retryAfterMs: opts.windowMs - (t - recent[0]) }
      }
      recent.push(t)
      hits.set(key, recent)
      // keep the map from growing without bound
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.every((at) => t - at >= opts.windowMs)) hits.delete(k)
      return { ok: true }
    },
  }
}
