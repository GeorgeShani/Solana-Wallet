import type { Context } from 'hono'
import { getConnInfo } from 'hono/bun'

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
