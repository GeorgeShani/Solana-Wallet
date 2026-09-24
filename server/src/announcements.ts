import { getAddressDecoder } from '@solana/addresses'
import { parseAnnouncements } from '@wallet/program-client'

/** One published stealth payment. Everything here is public on-chain already. */
export interface AnnouncementRow {
  /** Monotonic position in our index; clients ask for "everything after id N". */
  id: number
  signature: string
  blockTime: number | null
  /** The sender's ephemeral public key R (base58 of 32 bytes). */
  ephemeral: string
  /** The one-time address that was paid. */
  stealth: string
  viewTag: number
}

export type NewAnnouncement = Omit<AnnouncementRow, 'id'>

export interface AnnouncementStore {
  /** Adds rows in order. Rows already stored (same signature + position) are skipped. */
  insert(rows: NewAnnouncement[]): void
  /** Rows with id > afterId, oldest first. */
  since(afterId: number, limit: number): AnnouncementRow[]
  latestId(): number
  /** The newest program signature we have fully processed. */
  getCursor(): string | null
  setCursor(signature: string): void
}

export interface SignatureInfo {
  signature: string
  /** Non-null if the transaction failed; failed transactions emit nothing worth indexing. */
  err: unknown
  blockTime: number | null
}

/** Where announcements come from: the program's transaction history. */
export interface ProgramSource {
  /** Signatures involving the program, newest first. */
  listSignatures(opts: { before?: string; until?: string; limit: number }): Promise<SignatureInfo[]>
  /** The transaction's log messages, or null if it can't be found. */
  getLogs(signature: string): Promise<string[] | null>
}

export interface Indexer {
  /** Pull in anything new. Safe to call often: concurrent calls share one run and calls close together are skipped. */
  refresh(): Promise<void>
}

const PAGE = 100
const MAX_PAGES = 10 // on a first run, look back at most 1,000 transactions
const CONCURRENCY = 3
const addressDecoder = getAddressDecoder()

export function createIndexer(deps: {
  store: AnnouncementStore
  source: ProgramSource
  /** Don't hit the RPC again if the last run finished this recently. */
  minIntervalMs?: number
  now?: () => number
}): Indexer {
  const minInterval = deps.minIntervalMs ?? 5_000
  const now = deps.now ?? Date.now
  let lastRun = -Infinity
  let inflight: Promise<void> | null = null

  async function run() {
    const cursor = deps.store.getCursor() ?? undefined

    // Newest-first pages until we reach the cursor (or the look-back limit).
    const fresh: SignatureInfo[] = []
    let before: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await deps.source.listSignatures({ before, until: cursor, limit: PAGE })
      fresh.push(...batch)
      if (batch.length < PAGE) break
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
