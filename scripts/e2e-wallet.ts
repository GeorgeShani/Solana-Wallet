// Makes (once) a throwaway recovery phrase for end-to-end testing and prints its first accounts.
// The phrase lives in keys/e2e-seed.txt (git-ignored). Devnet only; never put real funds in it.
//
//   bun run --cwd scripts e2e-wallet

import WalletManagerSolana from '@tetherto/wdk-wallet-solana'
import * as bip39 from 'bip39'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = resolve(ROOT, 'keys/e2e-seed.txt')

if (!existsSync(FILE)) {
  mkdirSync(dirname(FILE), { recursive: true })
  writeFileSync(FILE, bip39.generateMnemonic(128) + '\n', { mode: 0o600 })
}
const manager = new WalletManagerSolana(readFileSync(FILE, 'utf8').trim(), { provider: 'https://api.devnet.solana.com' })
for (const i of [0, 1, 2]) console.log(`account ${i}: ${await (await manager.getAccount(i)).getAddress()}`)
process.exit(0)
