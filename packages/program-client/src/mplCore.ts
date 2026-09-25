// Just enough of Metaplex Core (the standard NFT program) to mint, list and send NFTs.
// A Core NFT is one account holding the owner, name and metadata URI, so minting costs a single
// small account and sending is one instruction. Written by hand, like the other builders here,
// so it only needs addresses and works with the wallet's signing flow.

import { address, getAddressDecoder, type Address } from '@solana/addresses'
import { AccountRole, type Instruction } from '@solana/instructions'
import { concat, u32, u8 } from './encoding'
import { SYSTEM_PROGRAM, type SignerMeta } from './token'

export const MPL_CORE_PROGRAM = address('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d')

/** First byte of every Core asset account (AssetV1). */
export const ASSET_KEY = 1

/** The limits Core itself enforces are looser; these keep NFTs small and readable in the UI. */
export const NFT_NAME_MAX = 32
export const NFT_URI_MAX = 200

const CREATE_V1 = 0
const TRANSFER_V1 = 14

const meta = (a: Address, role: AccountRole) => ({ address: a, role })
const utf8 = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

/** Borsh string: u32 length, then the bytes. */
const str = (s: string) => {
  const bytes = utf8.encode(s)
  return concat(u32(bytes.length), bytes)
}

/**
 * Mint a new NFT. `asset` is a fresh keypair whose address becomes the NFT's address, and it must
 * sign. Omitted optional accounts are passed as the program's own address, which is Core's way of
 * saying "not provided": the owner defaults to the payer and so does the update authority.
 */
export function createAssetInstruction(input: {
  asset: SignerMeta
  payer: Address
  owner?: Address
  name: string
  uri: string
}): Instruction {
  if (input.name.length === 0 || utf8.encode(input.name).length > NFT_NAME_MAX) {
    throw new RangeError(`An NFT name must be 1 to ${NFT_NAME_MAX} bytes`)
  }
  if (utf8.encode(input.uri).length > NFT_URI_MAX) throw new RangeError(`The metadata link is longer than ${NFT_URI_MAX} bytes`)
  const none = MPL_CORE_PROGRAM
  return {
    programAddress: MPL_CORE_PROGRAM,
    accounts: [
      input.asset, // must be a writable signer
      meta(none, AccountRole.READONLY), // collection
      meta(none, AccountRole.READONLY), // authority (defaults to the payer)
      meta(input.payer, AccountRole.WRITABLE_SIGNER),
      input.owner ? meta(input.owner, AccountRole.READONLY) : meta(none, AccountRole.READONLY),
      meta(none, AccountRole.READONLY), // update authority (defaults to the payer)
      meta(SYSTEM_PROGRAM, AccountRole.READONLY),
      meta(none, AccountRole.READONLY), // log wrapper
    ],
    // discriminator, data state (0 = keep the data in the account), name, uri, no plugins
    data: concat(u8(CREATE_V1), u8(0), str(input.name), str(input.uri), u8(0)),
  }
}

/** Send an NFT you own to someone else. */
export function transferAssetInstruction(input: { asset: Address; payer: Address; newOwner: Address }): Instruction {
  const none = MPL_CORE_PROGRAM
  return {
    programAddress: MPL_CORE_PROGRAM,
    accounts: [
      meta(input.asset, AccountRole.WRITABLE),
      meta(none, AccountRole.READONLY), // collection
      // payer and authority are the same wallet: it pays any extra rent and owns the NFT
      meta(input.payer, AccountRole.WRITABLE_SIGNER),
      meta(none, AccountRole.READONLY), // authority (defaults to the payer)
      meta(input.newOwner, AccountRole.READONLY),
      meta(SYSTEM_PROGRAM, AccountRole.READONLY),
      meta(none, AccountRole.READONLY), // log wrapper
    ],
    data: concat(u8(TRANSFER_V1), u8(0)), // no compression proof
  }
}

export interface DecodedAsset {
  owner: Address
  /** Who may change the NFT's data. Null when nobody can. */
  updateAuthority: Address | null
  name: string
  uri: string
}

/** Reads a Core asset account. Throws if the data is not an asset or is cut short. */
export function decodeAsset(data: Uint8Array): DecodedAsset {
  const need = (n: number, at: number) => {
    if (at + n > data.length) throw new Error('Not a valid NFT account')
  }
  need(1 + 32 + 1, 0)
  if (data[0] !== ASSET_KEY) throw new Error('Not an NFT account')
  const addr = getAddressDecoder()
  const owner = addr.decode(data.subarray(1, 33))
  let at = 33
  const tag = data[at++] // 0 none, 1 an address, 2 a collection
  let updateAuthority: Address | null = null
  if (tag === 1 || tag === 2) {
    need(32, at)
    updateAuthority = addr.decode(data.subarray(at, at + 32))
    at += 32
  } else if (tag !== 0) throw new Error('Not a valid NFT account')

  const readStr = () => {
    need(4, at)
    const len = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(at, true)
    at += 4
    need(len, at)
    const s = decoder.decode(data.subarray(at, at + len))
    at += len
    return s
  }
  const name = readStr()
  const uri = readStr()
  return { owner, updateAuthority, name, uri }
}

/** memcmp filters that select every Core asset owned by `owner` (key byte 1, then the owner at offset 1). */
export const assetsOwnedByFilters = (owner: Address) =>
  [
    { memcmp: { offset: 0n, bytes: '2', encoding: 'base58' } }, // base58 of the single byte 0x01
    { memcmp: { offset: 1n, bytes: owner as string, encoding: 'base58' } },
  ] as const
