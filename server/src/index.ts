import { createProgramSource, createServerWallet } from './admin'
import { createIndexer } from './announcements'
import { createApp } from './app'
import { loadConfig } from './config'
import { createAnnouncementStore, createFaucetStore, openDatabase } from './db'
import { createPriceService } from './prices'
import { DEVNET } from '@wallet/shared'

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
})

console.log(`Server wallet (fee relayer + faucet minter): ${wallet.address}`)
console.log(`Listening on http://localhost:${config.port}  (RPC: ${config.rpcUrl})`)

export default { port: config.port, fetch: app.fetch }
