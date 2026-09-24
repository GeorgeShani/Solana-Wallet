import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AnnouncementRow, AnnouncementStore } from './announcements'

/** Opens (creating if needed) the SQLite file. `:memory:` gives a throwaway database for tests. */
export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  return new Database(path)
}

// ------------------------------------------------------------------ faucet

/** Faucet bookkeeping: who got test tokens and when, so limits survive restarts. */
export interface FaucetStore {
  /** Unix ms of this address's latest claim, or null if it never claimed. */
  lastClaimAt(address: string): number | null
  /** How many claims this IP made since `sinceMs`. */
  claimsByIpSince(ip: string, sinceMs: number): number
  record(address: string, ip: string, at: number): void
}

export function createFaucetStore(db: Database): FaucetStore {
  db.run(`CREATE TABLE IF NOT EXISTS faucet_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL,
    ip TEXT NOT NULL,
    at INTEGER NOT NULL
  )`)
  db.run('CREATE INDEX IF NOT EXISTS faucet_address ON faucet_claims (address, at)')
  db.run('CREATE INDEX IF NOT EXISTS faucet_ip ON faucet_claims (ip, at)')

  const last = db.query<{ at: number }, [string]>('SELECT MAX(at) AS at FROM faucet_claims WHERE address = ?')
  const byIp = db.query<{ n: number }, [string, number]>('SELECT COUNT(*) AS n FROM faucet_claims WHERE ip = ? AND at >= ?')
  const insert = db.query('INSERT INTO faucet_claims (address, ip, at) VALUES (?, ?, ?)')

  return {
    lastClaimAt: (address) => last.get(address)?.at ?? null,
    claimsByIpSince: (ip, sinceMs) => byIp.get(ip, sinceMs)?.n ?? 0,
    record: (address, ip, at) => void insert.run(address, ip, at),
  }
}

export const openFaucetStore = (path: string) => createFaucetStore(openDatabase(path))

// ------------------------------------------------------------------ stealth announcements

export function createAnnouncementStore(db: Database): AnnouncementStore {
  db.run(`CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signature TEXT NOT NULL,
    position INTEGER NOT NULL,
    block_time INTEGER,
    ephemeral TEXT NOT NULL,
    stealth TEXT NOT NULL,
    view_tag INTEGER NOT NULL,
    UNIQUE (signature, position)
  )`)
  db.run('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)')

  interface Row {
    id: number
    signature: string
    block_time: number | null
    ephemeral: string
    stealth: string
    view_tag: number
  }
  const insertRow = db.query(
    `INSERT OR IGNORE INTO announcements (signature, position, block_time, ephemeral, stealth, view_tag)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const since = db.query<Row, [number, number]>(
    'SELECT id, signature, block_time, ephemeral, stealth, view_tag FROM announcements WHERE id > ? ORDER BY id LIMIT ?',
  )
  const latest = db.query<{ id: number | null }, []>('SELECT MAX(id) AS id FROM announcements')
  const getKv = db.query<{ value: string }, [string]>('SELECT value FROM kv WHERE key = ?')
  const setKv = db.query('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')

  const insertMany = db.transaction((rows: Omit<AnnouncementRow, 'id'>[]) => {
    const seen = new Map<string, number>() // position of each event within its transaction
    for (const r of rows) {
      const position = seen.get(r.signature) ?? 0
      seen.set(r.signature, position + 1)
      insertRow.run(r.signature, position, r.blockTime, r.ephemeral, r.stealth, r.viewTag)
    }
  })

  return {
    insert: (rows) => insertMany(rows),
    since: (afterId, limit) =>
      since.all(afterId, limit).map((r) => ({
        id: r.id,
        signature: r.signature,
        blockTime: r.block_time,
        ephemeral: r.ephemeral,
        stealth: r.stealth,
        viewTag: r.view_tag,
      })),
    latestId: () => latest.get()?.id ?? 0,
    getCursor: () => getKv.get('announcement_cursor')?.value ?? null,
    setCursor: (signature) => void setKv.run('announcement_cursor', signature),
  }
}
