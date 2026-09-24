import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** Faucet bookkeeping: who got test tokens and when, so limits survive restarts. */
export interface FaucetStore {
  /** Unix ms of this address's latest claim, or null if it never claimed. */
  lastClaimAt(address: string): number | null
  /** How many claims this IP made since `sinceMs`. */
  claimsByIpSince(ip: string, sinceMs: number): number
  record(address: string, ip: string, at: number): void
}

export function openFaucetStore(path: string): FaucetStore {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
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
