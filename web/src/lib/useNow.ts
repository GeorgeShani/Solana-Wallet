import { useEffect, useState } from 'react'

/** The current time in unix seconds, refreshed every `everyMs` so progress bars move. */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  return now
}

/** "in 2h 5m", "3d 4h ago", "now": a short human description of a moment relative to `now`. */
export function relativeTime(unix: number, now: number): string {
  const secs = unix - now
  if (Math.abs(secs) < 5) return 'now'
  const abs = Math.abs(secs)
  const d = Math.floor(abs / 86_400)
  const h = Math.floor((abs % 86_400) / 3_600)
  const m = Math.floor((abs % 3_600) / 60)
  const s = abs % 60
  const text = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`
  return secs > 0 ? `in ${text}` : `${text} ago`
}
