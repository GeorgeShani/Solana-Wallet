import { address, type Address } from '@solana/addresses'
import type { Instruction } from '@solana/instructions'
import {
  buildRelayableTransaction,
  CLAIM_LINK_SIZE,
  claimSolLinkInstruction,
  claimTokenLinkInstruction,
  createAssociatedTokenAccountIdempotent,
  createSolLinkInstruction,
  createTokenLinkInstruction,
  decodeClaimLink,
  deriveClaimAddresses,
  findAssociatedTokenAddress,
  findClaimAddress,
  PROGRAM_ADDRESS,
  refundSolLinkInstruction,
  refundTokenLinkInstruction,
  type DecodedClaimLink,
} from '@wallet/program-client'
import { getAccountsData, rpc } from '../wallet/rpc'
import type { LinkSecret } from './secret'

export interface LinkInfo extends DecodedClaimLink {
  /** The escrow account's address. */
  claim: Address
}

/** The escrow for a claim key, or null if it was never created, already claimed, or cancelled. */
export async function fetchLink(claimKey: Address): Promise<LinkInfo | null> {
  const claim = await findClaimAddress(claimKey)
  const [data] = await getAccountsData([claim])
  if (!data) return null
  try {
    return { ...decodeClaimLink(data), claim }
  } catch {
    return null
  }
}

/** Every open link created by `sender`, soonest expiry first. */
export async function fetchMyLinks(sender: string): Promise<LinkInfo[]> {
  const accounts = await rpc
    .getProgramAccounts(PROGRAM_ADDRESS, {
      encoding: 'base64',
      commitment: 'confirmed',
      filters: [
        { dataSize: BigInt(CLAIM_LINK_SIZE) },
        // the sender pubkey sits right after the 8-byte discriminator
        { memcmp: { offset: 8n, bytes: sender as never, encoding: 'base58' } },
      ],
    })
    .send()
  const links: LinkInfo[] = []
  for (const { pubkey, account } of accounts) {
    try {
      const bytes = Uint8Array.from(atob(account.data[0]), (c) => c.charCodeAt(0))
      links.push({ ...decodeClaimLink(bytes), claim: pubkey })
    } catch {
      /* not a link account: ignore */
    }
  }
  return links.sort((a, b) => Number(a.expiry - b.expiry))
}

export async function buildCreateLinkInstructions(input: {
  sender: string
  /** Token mint, or null for SOL. */
  mint: string | null
  claimKey: Address
  amount: bigint
  /** Unix seconds. */
  expiry: number
}): Promise<Instruction[]> {
  const sender = address(input.sender)
  const expiry = BigInt(input.expiry)
  if (input.mint === null) {
    const { claim } = await deriveClaimAddresses(input.claimKey)
    return [createSolLinkInstruction({ sender, claimKey: input.claimKey, claim, amount: input.amount, expiry })]
  }
  const mint = address(input.mint)
  const { claim, vault } = await deriveClaimAddresses(input.claimKey, mint)
  const senderToken = await findAssociatedTokenAddress(sender, mint)
  return [
    createTokenLinkInstruction({
      sender,
      claimKey: input.claimKey,
      mint,
      claim,
      vault: vault!,
      senderToken,
      amount: input.amount,
      expiry,
    }),
  ]
}

/** Cancel a link: the escrowed funds and the deposits go back to the sender. */
export async function buildCancelInstructions(link: LinkInfo): Promise<Instruction[]> {
  if (link.mint === null) return [refundSolLinkInstruction({ sender: link.sender, claim: link.claim })]
  const { vault } = await deriveClaimAddresses(link.claimKey, link.mint)
  const senderToken = await findAssociatedTokenAddress(link.sender, link.mint)
  return [
    // in case the sender closed their token account since creating the link
    createAssociatedTokenAccountIdempotent({ payer: link.sender, ata: senderToken, owner: link.sender, mint: link.mint }),
    refundTokenLinkInstruction({ sender: link.sender, claim: link.claim, mint: link.mint, vault: vault!, senderToken }),
  ]
}

/**
 * A claim transaction for the relayer to pay for. Signed here with the link's secret key (the
 * only signature the program needs); the relayer adds the fee payer's signature and broadcasts.
 */
export async function buildClaimTransaction(input: {
  link: LinkInfo
  secret: LinkSecret
  recipient: Address
  feePayer: Address
}): Promise<string> {
  const { link, secret, recipient, feePayer } = input
  let instructions: Instruction[]
  if (link.mint === null) {
    instructions = [claimSolLinkInstruction({ claimKey: secret.claimKey, claim: link.claim, sender: link.sender, recipient })]
  } else {
    const { vault } = await deriveClaimAddresses(secret.claimKey, link.mint)
    const recipientToken = await findAssociatedTokenAddress(recipient, link.mint)
    instructions = [
      // the fee payer opens the recipient's token account if they have none
      createAssociatedTokenAccountIdempotent({ payer: feePayer, ata: recipientToken, owner: recipient, mint: link.mint }),
      claimTokenLinkInstruction({
        claimKey: secret.claimKey,
        claim: link.claim,
        sender: link.sender,
        mint: link.mint,
        vault: vault!,
        recipientToken,
      }),
    ]
  }
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()
  return buildRelayableTransaction({ feePayer, claimKeyPair: secret.keyPair, instructions, blockhash })
}
