import { createServerWallet } from './admin'
import { createApp } from './app'
import { loadConfig } from './config'
import { openFaucetStore } from './db'
import { createPriceService } from './prices'

const config = loadConfig()
const wallet = await createServerWallet(config)

const app = createApp({
  corsOrigins: config.corsOrigins,
  chain: wallet.chain,
  relayer: wallet.relayer,
  minter: wallet.minter,
  faucetStore: openFaucetStore(config.dbPath),
  prices: createPriceService(),
})

console.log(`Server wallet (fee relayer + faucet minter): ${wallet.address}`)
console.log(`Listening on http://localhost:${config.port}  (RPC: ${config.rpcUrl})`)

export default { port: config.port, fetch: app.fetch }
