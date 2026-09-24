import { getProgramDerivedAddress, type Address } from '@solana/addresses'
import type { Instruction } from '@solana/instructions'
import { appendTransactionMessageInstructions, createTransactionMessage } from '@solana/transaction-messages'
import { concat, i64, readI64, readU64, u16, u64 } from './encoding'
import { addressFromBytes, build, findAssociatedTokenAddress, idl, PROGRAM_ADDRESS } from './core'
import { addressBytes } from './token'

export * from './encoding'
export * from './token'
export * from './timelocks'
export { describeProgramError, findAssociatedTokenAddress, instructionDiscriminator, PROGRAM_ADDRESS } from './core'

// ------------------------------------------------------------------ addresses

export interface PoolAddresses {
  pool: Address
  mintA: Address
  mintB: Address
  lpMint: Address
  vaultA: Address
  vaultB: Address
}

/** Order two mints the way the program requires (mint_a < mint_b by raw bytes). */
export function sortMints(x: Address, y: Address): [Address, Address] {
  const [bx, by] = [addressBytes(x), addressBytes(y)]
  for (let i = 0; i < 32; i++) {
    if (bx[i] !== by[i]) return bx[i] < by[i] ? [x, y] : [y, x]
  }
  throw new Error('A pool needs two different mints')
}

/** Derive the pool, its LP mint and both vaults for a pair of mints (any order). */
export async function derivePoolAddresses(x: Address, y: Address): Promise<PoolAddresses> {
  const [mintA, mintB] = sortMints(x, y)
  const [pool] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ADDRESS,
    seeds: ['pool', addressBytes(mintA), addressBytes(mintB)],
  })
  const [lpMint] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ADDRESS,
    seeds: ['lp', addressBytes(pool)],
  })
  const [vaultA, vaultB] = await Promise.all([
    findAssociatedTokenAddress(pool, mintA),
    findAssociatedTokenAddress(pool, mintB),
  ])
  return { pool, mintA, mintB, lpMint, vaultA, vaultB }
}

// ------------------------------------------------------------------ instructions

export function initPoolInstruction(input: { payer: Address; pool: PoolAddresses; feeBps: number }): Instruction {
  const { pool: p } = input
  return build(
    'init_pool',
    { payer: input.payer, mint_a: p.mintA, mint_b: p.mintB, pool: p.pool, lp_mint: p.lpMint, vault_a: p.vaultA, vault_b: p.vaultB },
    u16(input.feeBps),
  )
}

export interface LiquidityAccounts {
  user: Address
  pool: PoolAddresses
  userA: Address
  userB: Address
  userLp: Address
}

function liquidityAccounts(i: LiquidityAccounts): Record<string, Address> {
  return {
    user: i.user,
    pool: i.pool.pool,
    mint_a: i.pool.mintA,
    mint_b: i.pool.mintB,
    lp_mint: i.pool.lpMint,
    vault_a: i.pool.vaultA,
    vault_b: i.pool.vaultB,
    user_a: i.userA,
    user_b: i.userB,
    user_lp: i.userLp,
  }
}

export function addLiquidityInstruction(
  input: LiquidityAccounts & { amountADesired: bigint; amountBDesired: bigint; minLp: bigint },
): Instruction {
  return build(
    'add_liquidity',
    liquidityAccounts(input),
    concat(u64(input.amountADesired), u64(input.amountBDesired), u64(input.minLp)),
  )
}

export function removeLiquidityInstruction(
  input: LiquidityAccounts & { lpAmount: bigint; minAmountA: bigint; minAmountB: bigint },
): Instruction {
  return build(
    'remove_liquidity',
    liquidityAccounts(input),
    concat(u64(input.lpAmount), u64(input.minAmountA), u64(input.minAmountB)),
  )
}

export function swapInstruction(input: {
  user: Address
  pool: PoolAddresses
  userA: Address
  userB: Address
  amountIn: bigint
  minAmountOut: bigint
  aToB: boolean
}): Instruction {
  const p = input.pool
  return build(
    'swap',
    {
      user: input.user,
      pool: p.pool,
      mint_a: p.mintA,
      mint_b: p.mintB,
      vault_a: p.vaultA,
      vault_b: p.vaultB,
      user_a: input.userA,
      user_b: input.userB,
    },
    concat(u64(input.amountIn), u64(input.minAmountOut), Uint8Array.of(input.aToB ? 1 : 0)),
  )
}

// ------------------------------------------------------------------ claim links

export interface ClaimAddresses {
  claim: Address
  /** Escrow token account (only tokens links have one). */
  vault?: Address
}

/** The escrow PDA for a claim key (the public half of the link's secret). */
export async function findClaimAddress(claimKey: Address): Promise<Address> {
  const [claim] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ADDRESS,
    seeds: ['claim', addressBytes(claimKey)],
  })
  return claim
}

export async function deriveClaimAddresses(claimKey: Address, mint?: Address): Promise<ClaimAddresses> {
  const claim = await findClaimAddress(claimKey)
  return { claim, vault: mint ? await findAssociatedTokenAddress(claim, mint) : undefined }
}

export function createSolLinkInstruction(input: {
  sender: Address
  claimKey: Address
  claim: Address
  amount: bigint
  expiry: bigint
}): Instruction {
  return build(
    'create_sol_link',
    { sender: input.sender, claim_key: input.claimKey, claim: input.claim },
    concat(u64(input.amount), i64(input.expiry)),
  )
}

/** Pay a SOL link out. The claim key must sign the transaction; any fee payer will do. */
export function claimSolLinkInstruction(input: {
  claimKey: Address
  claim: Address
  sender: Address
  recipient: Address
}): Instruction {
  return build(
    'claim_sol_link',
    { claim_key: input.claimKey, claim: input.claim, sender: input.sender, recipient: input.recipient },
    new Uint8Array(),
  )
}

export function refundSolLinkInstruction(input: { sender: Address; claim: Address }): Instruction {
  return build('refund_sol_link', { sender: input.sender, claim: input.claim }, new Uint8Array())
}

export function createTokenLinkInstruction(input: {
  sender: Address
  claimKey: Address
  mint: Address
  claim: Address
  vault: Address
  senderToken: Address
  amount: bigint
  expiry: bigint
}): Instruction {
  return build(
    'create_token_link',
    {
      sender: input.sender,
      claim_key: input.claimKey,
      mint: input.mint,
      claim: input.claim,
      vault: input.vault,
      sender_token: input.senderToken,
    },
    concat(u64(input.amount), i64(input.expiry)),
  )
}

export function claimTokenLinkInstruction(input: {
  claimKey: Address
  claim: Address
  sender: Address
  mint: Address
  vault: Address
  recipientToken: Address
}): Instruction {
  return build(
    'claim_token_link',
    {
      claim_key: input.claimKey,
      claim: input.claim,
      sender: input.sender,
      mint: input.mint,
      vault: input.vault,
      recipient_token: input.recipientToken,
    },
    new Uint8Array(),
  )
}

export function refundTokenLinkInstruction(input: {
  sender: Address
  claim: Address
  mint: Address
  vault: Address
  senderToken: Address
}): Instruction {
  return build(
    'refund_token_link',
    { sender: input.sender, claim: input.claim, mint: input.mint, vault: input.vault, sender_token: input.senderToken },
    new Uint8Array(),
  )
}

export interface DecodedClaimLink {
  sender: Address
  claimKey: Address
  /** Token mint, or null for a native-SOL link. */
  mint: Address | null
  amount: bigint
  /** Unix time after which the link can't be claimed. */
  expiry: bigint
  bump: number
}

/** Size of a ClaimLink account: 8-byte discriminator + 3 pubkeys + u64 + i64 + u8. */
export const CLAIM_LINK_SIZE = 8 + 32 * 3 + 8 + 8 + 1

const CLAIM_LINK_DISCRIMINATOR = Uint8Array.from(idl.accounts.find((a) => a.name === 'ClaimLink')!.discriminator)
export { CLAIM_LINK_DISCRIMINATOR }

export function decodeClaimLink(data: Uint8Array): DecodedClaimLink {
  if (data.length < CLAIM_LINK_SIZE || !CLAIM_LINK_DISCRIMINATOR.every((b, i) => data[i] === b)) {
    throw new Error('Not a claim link account')
  }
  const addr = (offset: number) => addressFromBytes(data.subarray(offset, offset + 32))
  const mintBytes = data.subarray(72, 104)
  return {
    sender: addr(8),
    claimKey: addr(40),
    mint: mintBytes.every((b) => b === 0) ? null : addr(72),
    amount: readU64(data, 104),
    expiry: readI64(data, 112),
    bump: data[120],
  }
}

// ------------------------------------------------------------------ account decoding

export interface DecodedPool {
  mintA: Address
  mintB: Address
  lpMint: Address
  feeBps: number
  bump: number
}

const POOL_DISCRIMINATOR = Uint8Array.from(idl.accounts.find((a) => a.name === 'Pool')!.discriminator)

/** Decode a `Pool` account (8-byte discriminator, 3 pubkeys, u16 fee, u8 bump). */
export function decodePool(data: Uint8Array): DecodedPool {
  if (data.length < 8 + 32 * 3 + 3 || !POOL_DISCRIMINATOR.every((b, i) => data[i] === b)) {
    throw new Error('Not a Pool account')
  }
  const addr = (offset: number) => addressFromBytes(data.subarray(offset, offset + 32))
  return {
    mintA: addr(8),
    mintB: addr(40),
    lpMint: addr(72),
    feeBps: new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(104, true),
    bump: data[106],
  }
}

/** Token account balance (u64 at offset 64). */
export function decodeTokenAmount(data: Uint8Array): bigint {
  return readU64(data, 64)
}

/** Mint total supply (u64 at offset 36). */
export function decodeMintSupply(data: Uint8Array): bigint {
  return readU64(data, 36)
}

// ------------------------------------------------------------------ transactions

/** An unsigned v0 message holding these instructions; the wallet adds fee payer + blockhash. */
export function toTransactionMessage(instructions: Instruction[]) {
  return appendTransactionMessageInstructions(instructions, createTransactionMessage({ version: 0 }))
}
export * from './claimTx'
export * from './scalarSigned'
