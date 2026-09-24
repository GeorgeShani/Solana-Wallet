import { address, type Address } from '@solana/addresses'
import type { Instruction } from '@solana/instructions'
import {
  announceInstruction,
  createAssociatedTokenAccountIdempotent,
  findAssociatedTokenAddress,
  systemTransfer,
  transferChecked,
} from '@wallet/program-client'
import { createStealthPayment, publicKeyToAddress, type MetaAddress } from '@wallet/shared'

/** SOL sent along with a token payment so the one-time address can pay its own fees when spending. */
export const FEE_MARGIN_LAMPORTS = 20_000n

export interface StealthPaymentPlan {
  /** The one-time address being paid. */
  stealthAddress: Address
  instructions: Instruction[]
}

/**
 * Everything one private payment needs, as a single transaction:
 *  - SOL: a transfer to a freshly derived one-time address;
 *  - tokens: also open that address's token account, transfer the tokens, and add a little SOL
 *    ("gas") so the address can pay to move them later without anyone else's help;
 * then an `announce` so the recipient's wallet can find the payment. The announcement says nothing
 * about who sent it or who it is for.
 */
export async function planStealthPayment(input: {
  sender: string
  meta: MetaAddress
  /** Token mint, or null for SOL. */
  mint: string | null
  decimals: number
  amount: bigint
  /** Rent for a new token account, as the network currently sets it. */
  tokenAccountRent: bigint
  /** Test hook: fixed randomness for the derivation. */
  randomness?: Uint8Array
}): Promise<StealthPaymentPlan> {
  const sender = address(input.sender)
  const pay = createStealthPayment(input.meta, input.randomness)
  const stealth = address(publicKeyToAddress(pay.stealthPub))
  const ephemeral = address(publicKeyToAddress(pay.ephemeral))

  const instructions: Instruction[] = []
  if (input.mint === null) {
    instructions.push(systemTransfer({ from: sender, to: stealth, lamports: input.amount }))
  } else {
    const mint = address(input.mint)
    const [senderToken, stealthToken] = await Promise.all([
      findAssociatedTokenAddress(sender, mint),
      findAssociatedTokenAddress(stealth, mint),
    ])
    instructions.push(
      // enough for the address to open the destination's token account and pay the network fee
      systemTransfer({ from: sender, to: stealth, lamports: input.tokenAccountRent + FEE_MARGIN_LAMPORTS }),
      createAssociatedTokenAccountIdempotent({ payer: sender, ata: stealthToken, owner: stealth, mint }),
      transferChecked({
        source: senderToken,
        mint,
        destination: stealthToken,
        authority: sender,
        amount: input.amount,
        decimals: input.decimals,
      }),
    )
  }
  instructions.push(announceInstruction({ payer: sender, ephemeral, stealth, viewTag: pay.viewTag }))
  return { stealthAddress: stealth, instructions }
}
