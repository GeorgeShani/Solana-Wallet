// Creates the devnet test tokens (tUSDC, tBONK) and the three AMM pools, seeds them with
// liquidity, and writes the addresses to packages/shared/src/devnet.json.
//
//   bun run seed-devnet          (from the repo root: bun run --cwd scripts seed-devnet)
//
// The admin wallet is derived from keys/admin-seed.txt (git-ignored). First run creates that
// file and prints the address to fund with devnet SOL; run again once it has SOL.
// Re-running is safe: existing tokens/pools are detected and skipped.

import { address, type Address } from '@solana/addresses'
import { signature } from '@solana/keys'
import { createSolanaRpc } from '@solana/rpc'
import { generateKeyPairSigner } from '@solana/signers'
import WalletManagerSolana from '@tetherto/wdk-wallet-solana'
import {
  addLiquidityInstruction,
  createAssociatedTokenAccountIdempotent,
  derivePoolAddresses,
  findAssociatedTokenAddress,
  initializeMint2,
  initPoolInstruction,
  mintTo,
  syncNative,
  systemCreateAccount,
  systemTransfer,
  TOKEN_PROGRAM,
  toTransactionMessage,
  decodeTokenAmount,
  type PoolAddresses,
} from '@wallet/program-client'
import { quoteAdd, WSOL_DECIMALS, WSOL_MINT, type DevnetConfig, type PoolConfig, type SwapToken } from '@wallet/shared'
import * as bip39 from 'bip39'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SEED_FILE = resolve(ROOT, 'keys/admin-seed.txt')
const CONFIG_FILE = resolve(ROOT, 'packages/shared/src/devnet.json')
const RPC_URL = process.env.RPC_URL ?? 'https://api.devnet.solana.com'
const FEE_BPS = 30
/** SOL the admin needs: liquidity + rent + fees, with headroom. */
const MIN_ADMIN_LAMPORTS = 2_300_000_000n
const SOL = 1_000_000_000n

const rpc = createSolanaRpc(RPC_URL)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x))

// ------------------------------------------------------------------ token + pool plan

const NEW_TOKENS: Omit<SwapToken, 'mint'>[] = [
  { symbol: 'tUSDC', name: 'Test USD Coin', decimals: 6 },
  { symbol: 'tBONK', name: 'Test Bonk', decimals: 5 },
]
const units = (n: number, decimals: number) => BigInt(Math.round(n * 10 ** decimals))

/** Prices are consistent across pools: 1 SOL = 150 tUSDC = 6,000,000 tBONK. */
const POOL_PLAN: { x: string; xAmount: (t: Map<string, SwapToken>) => bigint; y: string; yAmount: (t: Map<string, SwapToken>) => bigint }[] = [
  { x: 'SOL', xAmount: () => 1n * SOL, y: 'tUSDC', yAmount: (t) => units(150, t.get('tUSDC')!.decimals) },
  { x: 'SOL', xAmount: () => 1n * SOL, y: 'tBONK', yAmount: (t) => units(6_000_000, t.get('tBONK')!.decimals) },
  { x: 'tUSDC', xAmount: (t) => units(150, t.get('tUSDC')!.decimals), y: 'tBONK', yAmount: (t) => units(6_000_000, t.get('tBONK')!.decimals) },
]

// ------------------------------------------------------------------ admin wallet

function loadOrCreateSeed(): { seed: string; created: boolean } {
  if (existsSync(SEED_FILE)) return { seed: readFileSync(SEED_FILE, 'utf8').trim(), created: false }
  mkdirSync(dirname(SEED_FILE), { recursive: true })
  const seed = bip39.generateMnemonic(128)
  writeFileSync(SEED_FILE, seed + '\n', { mode: 0o600 })
  return { seed, created: true }
}

const { seed, created } = loadOrCreateSeed()
const manager = new WalletManagerSolana(seed, { provider: RPC_URL, commitment: 'confirmed' })
const admin = await manager.getAccount(0)
const adminAddress = address(await admin.getAddress())
console.log(`Admin wallet: ${adminAddress}${created ? '  (new seed written to keys/admin-seed.txt)' : ''}`)

const balance = (await rpc.getBalance(adminAddress, { commitment: 'confirmed' }).send()).value
console.log(`Admin balance: ${Number(balance) / 1e9} SOL`)
// The full amount is only needed while pools still have to be seeded; a re-run on a
// finished setup just needs a little SOL for fees.
const alreadySeeded = (JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as DevnetConfig).pools.length >= POOL_PLAN.length
if (balance < (alreadySeeded ? 10_000_000n : MIN_ADMIN_LAMPORTS)) {
  console.log(`\nFund the admin wallet with at least ${Number(MIN_ADMIN_LAMPORTS) / 1e9} devnet SOL, then run this again.`)
  console.log(`  solana transfer ${adminAddress} 2.5 --allow-unfunded-recipient`)
  process.exit(created ? 0 : 1)
}

// ------------------------------------------------------------------ helpers

async function confirm(sig: string) {
  for (let i = 0; i < 90; i++) {
    const { value } = await rpc.getSignatureStatuses([signature(sig)]).send()
    const status = value[0]
    if (status?.err) throw new Error(`Transaction ${sig} failed: ${json(status.err)}`)
    if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) return
    await sleep(1000)
  }
  throw new Error(`Timed out waiting for ${sig}`)
}

async function send(label: string, instructions: Parameters<typeof toTransactionMessage>[0]) {
  const { hash } = await admin.sendTransaction(toTransactionMessage(instructions))
  await confirm(hash)
  console.log(`  ✓ ${label}  ${hash.slice(0, 16)}…`)
}

async function accountExists(a: Address): Promise<boolean> {
  return (await rpc.getAccountInfo(a, { commitment: 'confirmed', encoding: 'base64' }).send()).value !== null
}

async function tokenBalance(a: Address): Promise<bigint> {
  const info = await rpc.getAccountInfo(a, { commitment: 'confirmed', encoding: 'base64' }).send()
  if (!info.value) return 0n
  return decodeTokenAmount(Uint8Array.from(Buffer.from(info.value.data[0], 'base64')))
}

// ------------------------------------------------------------------ 1. tokens

const existing: DevnetConfig = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
const tokens = new Map<string, SwapToken>()
tokens.set('SOL', { mint: WSOL_MINT, symbol: 'SOL', name: 'Solana', decimals: WSOL_DECIMALS })
for (const t of existing.tokens) tokens.set(t.symbol, t)

console.log('\nTokens')
for (const spec of NEW_TOKENS) {
  if (tokens.has(spec.symbol)) {
    console.log(`  · ${spec.symbol} already exists: ${tokens.get(spec.symbol)!.mint}`)
    continue
  }
  const mint = await generateKeyPairSigner()
  const rent = (await rpc.getMinimumBalanceForRentExemption(82n).send())
  await send(`create ${spec.symbol} mint ${mint.address}`, [
    systemCreateAccount({
      payer: adminAddress,
      newAccount: { address: mint.address, role: 3 /* WRITABLE_SIGNER */, signer: mint },
      lamports: BigInt(rent),
      space: 82n,
      owner: TOKEN_PROGRAM,
    }),
    initializeMint2({ mint: mint.address, decimals: spec.decimals, mintAuthority: adminAddress }),
  ])
  tokens.set(spec.symbol, { mint: mint.address, ...spec })
}

// ------------------------------------------------------------------ 2. admin funds

console.log('\nAdmin token accounts')
const adminAta = new Map<string, Address>()
for (const t of tokens.values()) adminAta.set(t.symbol, await findAssociatedTokenAddress(adminAddress, address(t.mint)))
await send(
  'create admin token accounts',
  [...tokens.values()].map((t) =>
    createAssociatedTokenAccountIdempotent({ payer: adminAddress, ata: adminAta.get(t.symbol)!, owner: adminAddress, mint: address(t.mint) }),
  ),
)

// Work out which pools still need liquidity, and only mint/wrap what those need,
// so re-running a finished setup does nothing.
const planned = await Promise.all(
  POOL_PLAN.map(async (plan) => {
    const [tx, ty] = [tokens.get(plan.x)!, tokens.get(plan.y)!]
    const addrs: PoolAddresses = await derivePoolAddresses(address(tx.mint), address(ty.mint))
    const seeded = (await accountExists(addrs.vaultA)) && (await tokenBalance(addrs.vaultA)) > 0n
    return { plan, tx, ty, addrs, seeded }
  }),
)
const need = new Map<string, bigint>()
for (const { plan, seeded } of planned) {
  if (seeded) continue
  need.set(plan.x, (need.get(plan.x) ?? 0n) + plan.xAmount(tokens))
  need.set(plan.y, (need.get(plan.y) ?? 0n) + plan.yAmount(tokens))
}
for (const [symbol, amount] of need) {
  const ata = adminAta.get(symbol)!
  const have = await tokenBalance(ata)
  if (have >= amount) continue
  const missing = amount - have
  if (symbol === 'SOL') {
    await send(`wrap ${Number(missing) / 1e9} SOL`, [systemTransfer({ from: adminAddress, to: ata, lamports: missing }), syncNative(ata)])
  } else {
    await send(`mint ${missing} ${symbol}`, [mintTo({ mint: address(tokens.get(symbol)!.mint), destination: ata, authority: adminAddress, amount: missing })])
  }
}

// ------------------------------------------------------------------ 3. pools

console.log('\nPools')
const pools: PoolConfig[] = []
for (const { plan, tx, ty, addrs } of planned) {
  const label = `${tx.symbol}/${ty.symbol}`

  if (!(await accountExists(addrs.pool))) {
    await send(`init ${label} pool ${addrs.pool}`, [initPoolInstruction({ payer: adminAddress, pool: addrs, feeBps: FEE_BPS })])
  } else {
    console.log(`  · ${label} pool exists: ${addrs.pool}`)
  }

  if (!(await accountExists(addrs.vaultA)) || (await tokenBalance(addrs.vaultA)) === 0n) {
    // pool amounts are keyed by sorted mint order
    const aIsX = addrs.mintA === tx.mint
    const [wantA, wantB] = aIsX ? [plan.xAmount(tokens), plan.yAmount(tokens)] : [plan.yAmount(tokens), plan.xAmount(tokens)]
    const symbolA = aIsX ? tx.symbol : ty.symbol
    const symbolB = aIsX ? ty.symbol : tx.symbol
    const adminLp = await findAssociatedTokenAddress(adminAddress, addrs.lpMint)
    const quote = quoteAdd(0n, 0n, 0n, wantA, wantB)
    await send(`seed ${label} liquidity`, [
      createAssociatedTokenAccountIdempotent({ payer: adminAddress, ata: adminLp, owner: adminAddress, mint: addrs.lpMint }),
      addLiquidityInstruction({
        user: adminAddress,
        pool: addrs,
        userA: adminAta.get(symbolA)!,
        userB: adminAta.get(symbolB)!,
        userLp: adminLp,
        amountADesired: wantA,
        amountBDesired: wantB,
        minLp: quote.lp,
      }),
    ])
  }
  pools.push({
    pool: addrs.pool,
    mintA: addrs.mintA,
    mintB: addrs.mintB,
    lpMint: addrs.lpMint,
    vaultA: addrs.vaultA,
    vaultB: addrs.vaultB,
    feeBps: FEE_BPS,
  })
  console.log(`    reserves: ${await tokenBalance(addrs.vaultA)} / ${await tokenBalance(addrs.vaultB)}`)
}

// ------------------------------------------------------------------ 4. write config

const config: DevnetConfig = { programId: existing.programId, tokens: [...tokens.values()], pools }
writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n')
console.log(`\nWrote ${CONFIG_FILE}`)
console.log(`Mint authority for the test tokens: ${adminAddress}`)
admin.dispose()
