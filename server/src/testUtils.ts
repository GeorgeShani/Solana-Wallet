// Helpers for tests: build real, signed transactions in the shapes the relay sees.

import type { Address } from '@solana/addresses'
import type { Instruction } from '@solana/instructions'
import type { Blockhash } from '@solana/rpc-types'
import { generateKeyPairSigner, type KeyPairSigner } from '@solana/signers'
import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/transaction-messages'
import { compileTransaction, getBase64EncodedWireTransaction, partiallySignTransaction } from '@solana/transactions'
import {
  claimSolLinkInstruction,
  claimTokenLinkInstruction,
  createAssociatedTokenAccountIdempotent,
  deriveClaimAddresses,
  findAssociatedTokenAddress,
} from '@wallet/program-client'

const BLOCKHASH = { blockhash: '11111111111111111111111111111111' as Blockhash, lastValidBlockHeight: 1n }

export const newSigner = (): Promise<KeyPairSigner> => generateKeyPairSigner()

export async function buildTx(input: {
  feePayer: Address
  instructions: Instruction[]
  signers?: KeyPairSigner[]
}): Promise<{ base64: string; bytes: Uint8Array }> {
  const message = appendTransactionMessageInstructions(
    input.instructions,
    setTransactionMessageLifetimeUsingBlockhash(
      BLOCKHASH,
      setTransactionMessageFeePayer(input.feePayer, createTransactionMessage({ version: 0 })),
    ),
  )
  const tx = await partiallySignTransaction((input.signers ?? []).map((s) => s.keyPair), compileTransaction(message))
  const base64 = getBase64EncodedWireTransaction(tx)
  return { base64, bytes: Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)) }
}

/** The claim instructions a real client would send, for a fresh link. */
export async function claimFixtures(mint?: Address) {
  const [claimKey, sender, recipient] = await Promise.all([newSigner(), newSigner(), newSigner()])
  const { claim, vault } = await deriveClaimAddresses(claimKey.address, mint)
  const sol = claimSolLinkInstruction({
    claimKey: claimKey.address,
    claim,
    sender: sender.address,
    recipient: recipient.address,
  })
  return { claimKey, sender, recipient, claim, vault, sol, mint }
}

export async function tokenClaimFixtures(mint: Address, feePayer: Address) {
  const f = await claimFixtures(mint)
  const recipientToken = await findAssociatedTokenAddress(f.recipient.address, mint)
  const createAta = createAssociatedTokenAccountIdempotent({
    payer: feePayer,
    ata: recipientToken,
    owner: f.recipient.address,
    mint,
  })
  const claim = claimTokenLinkInstruction({
    claimKey: f.claimKey.address,
    claim: f.claim,
    sender: f.sender.address,
    mint,
    vault: f.vault!,
    recipientToken,
  })
  return { ...f, recipientToken, createAta, tokenClaim: claim }
}
