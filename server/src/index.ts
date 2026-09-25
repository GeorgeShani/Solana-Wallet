import { DEVNET } from '@wallet/shared'
import { createApp } from './app'
import { createProgramSource, createServerWallet } from './chain/solana'
import { loadConfig } from './config'
import { createAnnouncementStore, createIndexer } from './features/announcements'
import { createFaucetStore } from './features/faucet'
import { createFileNftStore } from './features/nft'
import { createPriceService } from './features/prices'
import { openDatabase } from './shared/db'

const config = loadConfig()
const wallet = await createServerWallet(config)
const db = openDatabase(config.dbPath)
const announcementStore = createAnnouncementStore(db)

const app = createApp({
  corsOrigins: config.corsOrigins,
  chain: wallet.chain,
  relayer: wallet.relayer,
  minter: wallet.minter,
  faucetStore: createFaucetStore(db),
  prices: createPriceService(),
  announcements: {
    store: announcementStore,
    indexer: createIndexer({ store: announcementStore, source: createProgramSource(config.rpcUrl), since: DEVNET.announcementsSince }),
  },
  nft: { store: createFileNftStore(config.nftDir), publicUrl: config.publicUrl },
})

console.log(`Server wallet (fee relayer + faucet minter): ${wallet.address}`)
console.log(`Listening on http://localhost:${config.port}  (RPC: ${config.rpcUrl})`)

export default { port: config.port, fetch: app.fetch }
