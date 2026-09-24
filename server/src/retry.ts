/**
 * Runs `fn`, retrying with exponential backoff when it throws. Public RPC endpoints answer bursts of
 * requests with HTTP 429; waiting a moment and trying again is the right response, not giving up.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 5
  const baseMs = opts.baseMs ?? 500
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e
      if (i < attempts - 1) await sleep(baseMs * 2 ** i)
    }
  }
  throw lastError
}
