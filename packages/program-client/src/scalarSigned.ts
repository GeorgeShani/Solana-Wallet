import type { Address } from '@solana/addresses'
import type { Instruction } from '@solana/instructions'
import type { Blockhash } from '@solana/rpc-types'
import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/transaction-messages'
import type { SignatureBytes } from '@solana/keys'
import { compileTransaction, getBase64EncodedWireTransaction } from '@solana/transactions'
import { signWithScalar } from '@wallet/shared'

/**
 * A transaction paid for and signed by a stealth address.
 *
 * A stealth address has a private *scalar* but no 32-byte seed, so a normal signer can't drive it.
 * We compile the transaction ourselves and sign its message bytes with `signWithScalar`, which
 * produces an ordinary Ed25519 signature. The stealth address is the fee payer and the only
 * signer, so every instruction may use it as its authority but must not need anyone else.
 * Returns base64 wire format, ready for `sendTransaction`.
 */
export function buildScalarSignedTransaction(input: {
  /** The stealth address; pays the fee and signs. */
  feePayer: Address
  /** Its private scalar. */
  scalar: bigint
  instructions: Instruction[]
  blockhash: { blockhash: Blockhash; lastValidBlockHeight: bigint }
}): string {
  const message = appendTransactionMessageInstructions(
    input.instructions,
    setTransactionMessageLifetimeUsingBlockhash(
      input.blockhash,
      setTransactionMessageFeePayer(input.feePayer, createTransactionMessage({ version: 0 })),
    ),
  )
  const tx = compileTransaction(message)
  const signers = Object.keys(tx.signatures)
  if (signers.length !== 1 || signers[0] !== input.feePayer) {
    throw new Error('A stealth transaction can only have the stealth address as its signer')
  }
  const signature = signWithScalar(input.scalar, Uint8Array.from(tx.messageBytes)) as unknown as SignatureBytes
  return getBase64EncodedWireTransaction({ ...tx, signatures: { [input.feePayer]: signature } })
}
