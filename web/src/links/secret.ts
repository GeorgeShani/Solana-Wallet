import { getAddressFromPublicKey, type Address } from '@solana/addresses'
import { getBase58Codec } from '@solana/codecs'
import { createKeyPairFromPrivateKeyBytes } from '@solana/keys'

// A claim link is `<origin>/claim#<secret>`. The secret is the private key of a throwaway
// keypair, base58-encoded. It lives after the `#`, which browsers never send to any server.
// Only the matching public key (the "claim key") is ever put on-chain.

export interface LinkSecret {
  /** base58 of the 32-byte private key: what goes in the URL. */
  secret: string
  keyPair: CryptoKeyPair
  /** The public key stored in the escrow account. */
  claimKey: Address
}

const codec = getBase58Codec()

async function fromBytes(bytes: Uint8Array): Promise<LinkSecret> {
  const keyPair = await createKeyPairFromPrivateKeyBytes(bytes)
  return { secret: codec.decode(bytes), keyPair, claimKey: await getAddressFromPublicKey(keyPair.publicKey) }
}

export function generateLinkSecret(): Promise<LinkSecret> {
  return fromBytes(crypto.getRandomValues(new Uint8Array(32)))
}

/** Parses the text after `#`. Returns null if it is not a valid secret. */
export async function parseLinkSecret(fragment: string): Promise<LinkSecret | null> {
  const text = fragment.replace(/^#/, '').trim()
  if (!text) return null
  try {
    const bytes = codec.encode(text)
    return bytes.length === 32 ? await fromBytes(Uint8Array.from(bytes)) : null
  } catch {
    return null
  }
}

export const claimUrl = (secret: string, origin = globalThis.location?.origin ?? '') => `${origin}/claim#${secret}`
