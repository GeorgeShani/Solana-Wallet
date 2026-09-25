// Checks the NFT code against real devnet: mints a Metaplex Core NFT from the admin wallet, finds it
// by owner, sends it to another address, and confirms the new owner.
//
//   bun run --cwd scripts nft-smoke [recipient-address]
//
// It costs about 0.003 devnet SOL (refundless: the NFT account keeps its rent). Uses the same
// builders the web app uses, so a pass here means the wallet's mint and send instructions are right.

import { address } from '@solana/addresses'
import { signature } from '@solana/keys'
import { createSolanaRpc } from '@solana/rpc'
import { generateKeyPairSigner } from '@solana/signers'
import WalletManagerSolana from '@tetherto/wdk-wallet-solana'
import {
  assetsOwnedByFilters,
  createAssetInstruction,
  decodeAsset,
  MPL_CORE_PROGRAM,
  toTransactionMessage,
  transferAssetInstruction,
} from '@wallet/program-client'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RPC_URL = process.env.RPC_URL ?? 'https://api.devnet.solana.com'
const rpc = createSolanaRpc(RPC_URL)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const seed = readFileSync(resolve(ROOT, 'keys/admin-seed.txt'), 'utf8').trim()
const manager = new WalletManagerSolana(seed, { provider: RPC_URL, commitment: 'confirmed' })
const account = await manager.getAccount(0)
const me = address(await account.getAddress())
const recipient = address(process.argv[2] ?? '5PgQWusbALXk1PcrPC1BVuXV87R25Rhryu9HsmJvipP4')

async function confirm(sig: string) {
  for (let i = 0; i < 40; i++) {
    const { value } = await rpc.getSignatureStatuses([signature(sig)]).send()
    const s = value[0]
    if (s?.err) throw new Error(`Transaction failed: ${JSON.stringify(s.err, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`)
    if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return
    await sleep(1_000)
  }
  throw new Error('Timed out waiting for confirmation')
}

async function owned(owner: string) {
  const accounts = await rpc
    .getProgramAccounts(MPL_CORE_PROGRAM, { encoding: 'base64', commitment: 'confirmed', filters: assetsOwnedByFilters(address(owner)) as never })
    .send()
  return accounts.map(({ pubkey, account }) => ({ address: pubkey, ...decodeAsset(Uint8Array.from(Buffer.from(account.data[0], 'base64'))) }))
}

console.log(`Minting from ${me}`)
const asset = await generateKeyPairSigner()
const mint = createAssetInstruction({
  asset: { address: asset.address, role: 3 /* WRITABLE_SIGNER */, signer: asset } as never,
  payer: me,
  name: 'Smoke Test',
  uri: 'http://localhost:3000/nft/smoke/metadata.json',
})
const minted = await account.sendTransaction(toTransactionMessage([mint]))
await confirm(minted.hash)
console.log(`  minted ${asset.address}  (${minted.hash})`)

const found = (await owned(me)).find((n) => n.address === asset.address)
if (!found) throw new Error('The new NFT was not found by owner')
if (found.name !== 'Smoke Test' || found.owner !== me) throw new Error(`Unexpected NFT contents: ${JSON.stringify(found)}`)
console.log(`  found by owner: "${found.name}" -> ${found.uri}`)

const sent = await account.sendTransaction(toTransactionMessage([transferAssetInstruction({ asset: asset.address, payer: me, newOwner: recipient })]))
await confirm(sent.hash)
console.log(`  sent to ${recipient}  (${sent.hash})`)

await sleep(1_500)
const theirs = await owned(recipient)
if (!theirs.some((n) => n.address === asset.address)) throw new Error('The recipient does not own the NFT')
// the public RPC's account scans can lag a moment behind a transfer: allow a few tries
let stillMine = true
for (let i = 0; i < 8 && stillMine; i++) {
  stillMine = (await owned(me)).some((n) => n.address === asset.address)
  if (stillMine) await sleep(1_500)
}
if (stillMine) throw new Error('The sender still owns the NFT')
console.log('OK: minted, found by owner, transferred, and the ownership changed.')
process.exit(0)
