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
