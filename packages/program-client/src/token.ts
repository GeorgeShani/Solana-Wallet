// Hand-encoded instructions for the System, SPL Token and Associated Token programs.
// They only take addresses (no signer objects), so a wallet that signs elsewhere can use
// them: the transaction's fee payer signs for every account marked as a signer.

import { address, getAddressEncoder, type Address } from '@solana/addresses'
import { AccountRole, type Instruction } from '@solana/instructions'
import { concat, u32, u64, u8 } from './encoding'

export const SYSTEM_PROGRAM = address('11111111111111111111111111111111')
export const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
export const ASSOCIATED_TOKEN_PROGRAM = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

const meta = (a: Address, role: AccountRole) => ({ address: a, role })

/** Anything that can be a signature-bearing account (a plain address, or one with an embedded signer). */
export type SignerMeta = { address: Address; role: AccountRole; signer?: unknown }

/** Create the owner's associated token account for `mint` if it doesn't exist yet. */
export function createAssociatedTokenAccountIdempotent(input: {
  payer: Address
  ata: Address
  owner: Address
  mint: Address
}): Instruction {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    accounts: [
      meta(input.payer, AccountRole.WRITABLE_SIGNER),
      meta(input.ata, AccountRole.WRITABLE),
      meta(input.owner, AccountRole.READONLY),
      meta(input.mint, AccountRole.READONLY),
      meta(SYSTEM_PROGRAM, AccountRole.READONLY),
      meta(TOKEN_PROGRAM, AccountRole.READONLY),
    ],
    data: Uint8Array.of(1), // CreateIdempotent
  }
}

export function systemTransfer(input: { from: Address; to: Address; lamports: bigint }): Instruction {
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [meta(input.from, AccountRole.WRITABLE_SIGNER), meta(input.to, AccountRole.WRITABLE)],
    data: concat(u32(2), u64(input.lamports)),
  }
}

/** System `CreateAccount`. `newAccount` may carry its own signer (a fresh keypair). */
export function systemCreateAccount(input: {
  payer: Address
  newAccount: SignerMeta
  lamports: bigint
  space: bigint
  owner: Address
}): Instruction {
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [meta(input.payer, AccountRole.WRITABLE_SIGNER), input.newAccount],
    data: concat(u32(0), u64(input.lamports), u64(input.space), addressBytes(input.owner)),
  }
}

/** SPL Token `TransferChecked`: moves tokens between two token accounts, verifying the mint's decimals. */
export function transferChecked(input: {
  source: Address
  mint: Address
  destination: Address
  /** The source account's owner, who must sign. */
  authority: Address
  amount: bigint
  decimals: number
}): Instruction {
  return {
    programAddress: TOKEN_PROGRAM,
    accounts: [
      meta(input.source, AccountRole.WRITABLE),
      meta(input.mint, AccountRole.READONLY),
      meta(input.destination, AccountRole.WRITABLE),
      meta(input.authority, AccountRole.READONLY_SIGNER),
    ],
    data: concat(u8(12), u64(input.amount), u8(input.decimals)),
  }
}

/** Refresh a wrapped-SOL account's token balance after lamports were sent to it. */
export function syncNative(account: Address): Instruction {
  return {
    programAddress: TOKEN_PROGRAM,
    accounts: [meta(account, AccountRole.WRITABLE)],
    data: u8(17),
  }
}

/** Close a token account (unwraps wSOL), sending all its lamports to `destination`. */
export function closeTokenAccount(input: { account: Address; destination: Address; owner: Address }): Instruction {
  return {
    programAddress: TOKEN_PROGRAM,
    accounts: [
      meta(input.account, AccountRole.WRITABLE),
      meta(input.destination, AccountRole.WRITABLE),
      meta(input.owner, AccountRole.READONLY_SIGNER),
    ],
    data: u8(9),
  }
}

export function initializeMint2(input: { mint: Address; decimals: number; mintAuthority: Address }): Instruction {
  return {
    programAddress: TOKEN_PROGRAM,
    accounts: [meta(input.mint, AccountRole.WRITABLE)],
    data: concat(u8(20), u8(input.decimals), addressBytes(input.mintAuthority), u8(0)), // no freeze authority
  }
}

export function mintTo(input: { mint: Address; destination: Address; authority: Address; amount: bigint }): Instruction {
  return {
    programAddress: TOKEN_PROGRAM,
    accounts: [
      meta(input.mint, AccountRole.WRITABLE),
      meta(input.destination, AccountRole.WRITABLE),
      meta(input.authority, AccountRole.READONLY_SIGNER),
    ],
    data: concat(u8(7), u64(input.amount)),
  }
}

// base58 -> 32 raw bytes (what instruction data needs for a Pubkey argument)
const encoder = getAddressEncoder()
export function addressBytes(a: Address): Uint8Array {
  return Uint8Array.from(encoder.encode(a))
}
