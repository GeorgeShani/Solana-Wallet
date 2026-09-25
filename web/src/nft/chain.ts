import { address, type Address } from '@solana/addresses'
import { AccountRole, type Instruction } from '@solana/instructions'
import { generateKeyPairSigner } from '@solana/signers'
import {
  assetsOwnedByFilters,
  createAssetInstruction,
  decodeAsset,
  MPL_CORE_PROGRAM,
  transferAssetInstruction,
} from '@wallet/program-client'
import { rpc } from '../wallet/rpc'

export interface Nft {
  /** The NFT's own address. */
  address: Address
  owner: Address
  name: string
  /** Link to the JSON describing the NFT (description, picture). */
  uri: string
}

/** Every Metaplex Core NFT `owner` holds. Read straight from the network, so no extra service is needed. */
export async function fetchNfts(owner: string): Promise<Nft[]> {
  const accounts = await rpc
    .getProgramAccounts(MPL_CORE_PROGRAM, {
      encoding: 'base64',
      commitment: 'confirmed',
      filters: assetsOwnedByFilters(address(owner)) as never,
    })
    .send()
  const nfts: Nft[] = []
  for (const { pubkey, account } of accounts) {
    try {
      const asset = decodeAsset(Uint8Array.from(atob(account.data[0]), (c) => c.charCodeAt(0)))
      nfts.push({ address: pubkey, owner: asset.owner, name: asset.name, uri: asset.uri })
    } catch {
      /* not something we can show: skip it */
    }
  }
  // the network gives no order (and an NFT has no timestamp), so keep the grid stable by sorting on name
  return nfts.sort((a, b) => a.name.localeCompare(b.name) || a.address.localeCompare(b.address))
}

export interface NftDetails {
  description: string
  /** Only ever an http(s) link, so a hostile NFT cannot smuggle in a script. */
  image: string | null
}

/** True for links that are safe to put in an <img>. */
export const isWebUrl = (u: unknown): u is string => {
  if (typeof u !== 'string') return false
  try {
    const { protocol } = new URL(u)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/** Reads an NFT's description and picture from its metadata link. Returns null if it can't be reached. */
export async function fetchNftDetails(uri: string, signal?: AbortSignal): Promise<NftDetails | null> {
  if (!isWebUrl(uri)) return null
  try {
    const res = await fetch(uri, { signal })
    if (!res.ok) return null
    const json = (await res.json()) as { description?: unknown; image?: unknown }
    return {
      description: typeof json.description === 'string' ? json.description.slice(0, 1000) : '',
      image: isWebUrl(json.image) ? json.image : null,
    }
  } catch {
    return null
  }
}

/**
 * The instructions to mint an NFT. The new NFT is a fresh address that has to co-sign once, so the
 * signer travels inside the instruction and the wallet signs with both keys.
 */
export async function buildMint(input: { payer: string; name: string; uri: string }): Promise<{ address: Address; instructions: Instruction[] }> {
  const asset = await generateKeyPairSigner()
  const instructions = [
    createAssetInstruction({
      asset: { address: asset.address, role: AccountRole.WRITABLE_SIGNER, signer: asset } as never,
      payer: address(input.payer),
      name: input.name,
      uri: input.uri,
    }),
  ]
  return { address: asset.address, instructions }
}

export const buildSend = (input: { nft: Address; from: string; to: string }): Instruction[] => [
  transferAssetInstruction({ asset: input.nft, payer: address(input.from), newOwner: address(input.to) }),
]

/** Query key for a wallet's NFT list. */
export const nftsKey = (address: string | null) => ['nfts', address] as const
