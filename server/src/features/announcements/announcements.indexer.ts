import { getAddressDecoder } from '@solana/addresses'
import { parseAnnouncements } from '@wallet/program-client'
import type { AnnouncementStore, Indexer, NewAnnouncement, ProgramSource, SignatureInfo } from './announcements.types'

const PAGE = 100
const MAX_PAGES = 10 // on a first run, look back at most 1,000 transactions
const CONCURRENCY = 3
const addressDecoder = getAddressDecoder()

export function createIndexer(deps: {
  store: AnnouncementStore
  source: ProgramSource
  /** Don't hit the RPC again if the last run finished this recently. */
  minIntervalMs?: number
  /**
   * Unix seconds. Transactions older than this are ignored without being fetched: announcements
   * can't exist before the program version that emits them was deployed.
   */
  since?: number
  now?: () => number
}): Indexer {
  const minInterval = deps.minIntervalMs ?? 5_000
  const now = deps.now ?? Date.now
  let lastRun = -Infinity
  let inflight: Promise<void> | null = null

  async function run() {
    const cursor = deps.store.getCursor() ?? undefined

    // Newest-first pages until we reach the cursor (or the look-back limit).
    const isNew = (s: SignatureInfo) => deps.since === undefined || s.blockTime === null || s.blockTime >= deps.since
    const fresh: SignatureInfo[] = []
    let before: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await deps.source.listSignatures({ before, until: cursor, limit: PAGE })
      fresh.push(...batch.filter(isNew))
      // pages are newest first: once one contains something too old, nothing further back matters
      if (batch.length < PAGE || !batch.every(isNew)) break
      before = batch[batch.length - 1].signature
    }
    if (fresh.length === 0) return

    // Process oldest first so ids follow chain order and a failure leaves no gap behind the cursor.
    fresh.reverse()
    let processed: string | null = null
    for (let i = 0; i < fresh.length; i += CONCURRENCY) {
      const group = fresh.slice(i, i + CONCURRENCY)
      let logs: (string[] | null)[]
      try {
        logs = await Promise.all(group.map((s) => (s.err ? Promise.resolve([]) : deps.source.getLogs(s.signature))))
      } catch (e) {
        console.warn('Announcement indexing paused:', e instanceof Error ? e.message : e)
        break // resume from `processed` on the next refresh
      }
      if (logs.some((l) => l === null)) break // not available yet: try again next time
      const rows: NewAnnouncement[] = []
      group.forEach((s, gi) => {
        parseAnnouncements(logs[gi]!).forEach((a) =>
          rows.push({
            signature: s.signature,
            blockTime: s.blockTime,
            ephemeral: addressDecoder.decode(a.ephemeral),
            stealth: a.stealth,
            viewTag: a.viewTag,
          }),
        )
      })
      deps.store.insert(rows)
      processed = group[group.length - 1].signature
      deps.store.setCursor(processed)
    }
  }

  return {
    async refresh() {
      if (inflight) return inflight
      if (now() - lastRun < minInterval) return
      inflight = run()
        .catch((e) => console.warn('Announcement refresh failed:', e instanceof Error ? e.message : e))
        .finally(() => {
          lastRun = now()
          inflight = null
        })
      return inflight
    },
  }
}
