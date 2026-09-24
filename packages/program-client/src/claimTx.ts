import type { Address } from '@solana/addresses'
import type { Instruction } from '@solana/instructions'
import type { Blockhash } from '@solana/rpc-types'
import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/transaction-messages'
import { compileTransaction, getBase64EncodedWireTransaction, partiallySignTransaction } from '@solana/transactions'

/**
 * A transaction whose fee is paid by someone else (the relayer) and that is signed here by the
 * claim key only. The fee payer's signature slot stays empty; the relayer fills it in and
 * broadcasts. Returns the base64 wire format the relayer's API takes.
 */
export async function buildRelayableTransaction(input: {
  feePayer: Address
  /** The link's secret key: the only signer the program requires for a claim. */
  claimKeyPair: CryptoKeyPair
  instructions: Instruction[]
  blockhash: { blockhash: Blockhash; lastValidBlockHeight: bigint }
}): Promise<string> {
  const message = appendTransactionMessageInstructions(
    input.instructions,
    setTransactionMessageLifetimeUsingBlockhash(
      input.blockhash,
      setTransactionMessageFeePayer(input.feePayer, createTransactionMessage({ version: 0 })),
    ),
  )
  const partiallySigned = await partiallySignTransaction([input.claimKeyPair], compileTransaction(message))
  return getBase64EncodedWireTransaction(partiallySigned)
}
