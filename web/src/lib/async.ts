/** Runs `fn` over `items` with at most `limit` calls in flight, keeping the results in order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** Tries `fn` again with growing pauses (the public RPC answers "429 too many requests" in bursts). */
export async function retry<T>(
  fn: () => Promise<T>,
  { attempts = 4, baseMs = 500, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = {},
): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      if (i < attempts - 1) await sleep(baseMs * 2 ** i)
    }
  }
  throw last
}
