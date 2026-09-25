import { address, type Address } from '@solana/addresses'
import { partiallySignTransaction } from '@solana/transactions'
import { createApp, type Deps } from '../app'
import { createAnnouncementStore } from '../features/announcements/announcements.store'
import { createFaucetStore } from '../features/faucet/faucet.store'
import { openDatabase } from './db'
import { createIndexer } from '../features/announcements/announcements.indexer'
import { createMemoryNftStore } from '../features/nft/nft.store'
import { createRateLimiter } from './rateLimit'
import { newSigner } from './testUtils'
import type { Chain, Minter, Relayer } from '../chain/types'

export const ORIGIN = 'http://localhost:5173'
export const RICH = 10_000_000_000n

export async function setup(overrides: Partial<Deps> & { balance?: bigint; minterDelay?: Promise<void> } = {}) {
  const signer = await newSigner()
  const sent: string[] = []
  const minted: { recipient: Address; amounts: string[] }[] = []
  const chain: Chain = {
    sendTransaction: async (b64) => {
      sent.push(b64)
      return 'FakeSignature1111111111111111111111111111111111'
    },
    getBalance: async () => overrides.balance ?? RICH,
    confirm: async () => {},
  }
  const relayer: Relayer = {
    address: signer.address,
    sign: (tx) => partiallySignTransaction([signer.keyPair], tx as Parameters<typeof partiallySignTransaction>[1]),
  }
  const minter: Minter = {
    address: signer.address,
    mintTokens: async (recipient, drops) => {
      await overrides.minterDelay
      minted.push({ recipient, amounts: drops.map((d) => d.amount.toString()) })
      return 'MintSignature11111111111111111111111111111111111'
    },
  }
  let clock = 1_000_000_000_000
  const db = openDatabase(':memory:')
  const announcementStore = createAnnouncementStore(db)
  const app = createApp({
    corsOrigins: [ORIGIN],
    chain,
    relayer,
    minter,
    faucetStore: createFaucetStore(db),
    announcements: {
      store: announcementStore,
      indexer: createIndexer({ store: announcementStore, source: { listSignatures: async () => [], getLogs: async () => null } }),
    },
    nft: { store: createMemoryNftStore(), publicUrl: 'http://localhost:3000' },
    prices: { get: async () => ({ solUsd: 150.25, updatedAt: 1, stale: false }) },
    now: () => clock,
    ...overrides,
  })
  return { app, signer, sent, minted, advance: (ms: number) => (clock += ms) }
}

export const post = (app: { request: (u: string, i?: RequestInit) => Response | Promise<Response> }, path: string, body: unknown, ip = '1.1.1.1') =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
