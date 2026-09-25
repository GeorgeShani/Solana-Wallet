import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface Config {
  port: number
  rpcUrl: string
  /** Seed phrase of the server wallet: mint authority of the test tokens and the relayer's fee payer. */
  adminSeed: string
  /** Origins allowed to call the API from a browser. */
  corsOrigins: string[]
  dbPath: string
  /** Where uploaded NFT pictures are kept. */
  nftDir: string
  /** This server's address as seen from a browser: it goes into NFT metadata links. */
  publicUrl: string
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Reads settings from the environment (see server/.env.example).
 *  ADMIN_SEED       the server wallet's seed phrase, or
 *  ADMIN_SEED_FILE  a file containing it (default: keys/admin-seed.txt, created by scripts/seed-devnet.ts)
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const seedFile = env.ADMIN_SEED_FILE ?? resolve(ROOT, 'keys/admin-seed.txt')
  const adminSeed = env.ADMIN_SEED ?? (existsSync(seedFile) ? readFileSync(seedFile, 'utf8').trim() : '')
  if (!adminSeed) {
    throw new Error(
      `No server wallet found. Set ADMIN_SEED, or run "bun run --cwd scripts seed-devnet" to create ${seedFile}.`,
    )
  }
  return {
    port: Number(env.PORT ?? 3000),
    rpcUrl: env.RPC_URL ?? 'https://api.devnet.solana.com',
    adminSeed,
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim()),
    dbPath: env.DB_PATH ?? resolve(ROOT, 'server/data/wallet.db'),
    nftDir: env.NFT_DIR ?? resolve(ROOT, 'server/data/nft'),
    publicUrl: env.PUBLIC_URL ?? `http://localhost:${env.PORT ?? 3000}`,
  }
}
