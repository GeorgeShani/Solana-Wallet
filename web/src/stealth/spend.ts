import { address } from '@solana/addresses'
import type { Instruction } from '@solana/instructions'
import {
  buildScalarSignedTransaction,
  closeTokenAccount,
  createAssociatedTokenAccountIdempotent,
  findAssociatedTokenAddress,
  systemTransfer,
  transferChecked,
} from '@wallet/program-client'
import { SYSTEM_ACCOUNT_SIZE, TOKEN_ACCOUNT_SIZE } from '../config'
import {
  confirmSignature,
  getRentExemption,
  getSolBalance,
  getTokenHoldings,
  hasTokenAccount,
  rpc,
  type TokenHolding,
} from '../wallet/rpc'
import type { FoundPayment } from './scan'

/** One signature at 5,000 lamports. A stealth transaction has exactly one signer. */
export const SWEEP_FEE_LAMPORTS = 5_000n
const MAX_TOKENS_PER_SWEEP = 3

export interface SweepPlan {
  instructions: Instruction[]
  /** SOL that will arrive at the destination. */
  solOut: bigint
  tokens: TokenHolding[]
}

/**
 * Move everything at a one-time address to `destination`, in one transaction that the one-time
 * address pays for itself (so no other account is ever linked to it as fee payer).
 *
 * Tokens go first (opening the destination's token accounts, paid from the address's own SOL, then
 * closing the emptied ones so their rent follows), then all the SOL that is left after fees.
 */
export function planSweep(input: {
  from: string
  destination: string
  solBalance: bigint
  tokens: TokenHolding[]
  destinationHasToken: Map<string, boolean>
  destinationSolBalance: bigint
  /** Precomputed associated token addresses, keyed `${owner}:${mint}`. */
  ata: (owner: string, mint: string) => string
  tokenAccountRent: bigint
  minSystemBalance: bigint
}): SweepPlan {
  const p = address(input.from)
  const dest = address(input.destination)
  const tokens = input.tokens.filter((t) => t.amount > 0n)
  if (tokens.length > MAX_TOKENS_PER_SWEEP) {
    throw new Error(`This address holds ${tokens.length} different tokens. Withdraw them in smaller steps.`)
  }

  const ixs: Instruction[] = []
  let cost = SWEEP_FEE_LAMPORTS
  for (const t of tokens) {
    const mint = address(t.mint)
    const destAta = address(input.ata(input.destination, t.mint))
    if (!input.destinationHasToken.get(t.mint)) cost += input.tokenAccountRent
    ixs.push(
      createAssociatedTokenAccountIdempotent({ payer: p, ata: destAta, owner: dest, mint }),
      transferChecked({
        source: address(t.tokenAccount),
        mint,
        destination: destAta,
        authority: p,
        amount: t.amount,
        decimals: t.decimals,
      }),
      // the emptied account's rent goes to the destination, not back to the one-time address
      closeTokenAccount({ account: address(t.tokenAccount), destination: dest, owner: p }),
    )
  }

  const solOut = input.solBalance - cost
  if (solOut < 0n) {
    throw new Error('This address does not hold enough SOL to pay the network fee for moving its tokens.')
  }
  if (solOut === 0n && tokens.length === 0) throw new Error('There is nothing to withdraw from this address.')
  if (solOut > 0n) {
    if (input.destinationSolBalance + solOut < input.minSystemBalance) {
      throw new Error('That amount is too small to open the destination account. Use an address that already has some SOL.')
    }
    ixs.push(systemTransfer({ from: p, to: dest, lamports: solOut }))
  }
  return { instructions: ixs, solOut, tokens }
}

/** Reads the address's balances, plans the sweep, signs it with the stealth key and sends it. */
export async function sweepStealthAddress(input: {
  payment: FoundPayment
  destination: string
}): Promise<{ signature: string; plan: SweepPlan }> {
  const { payment, destination } = input
  const [solBalance, allTokens, destinationSolBalance, tokenRent, minSystem] = await Promise.all([
    getSolBalance(payment.address),
    getTokenHoldings(payment.address),
    getSolBalance(destination),
    getRentExemption(TOKEN_ACCOUNT_SIZE),
    getRentExemption(SYSTEM_ACCOUNT_SIZE),
  ])
  // payments create classic SPL Token accounts, so those are what we move
  const tokens = allTokens.filter((t) => t.amount > 0n)
  const atas = new Map<string, string>()
  await Promise.all(
    tokens.map(async (t) => atas.set(`${destination}:${t.mint}`, await findAssociatedTokenAddress(address(destination), address(t.mint)))),
  )
  const destinationHasToken = new Map<string, boolean>()
  await Promise.all(tokens.map(async (t) => destinationHasToken.set(t.mint, await hasTokenAccount(destination, t.mint))))

  const plan = planSweep({
    from: payment.address,
    destination,
    solBalance,
    tokens,
    destinationHasToken,
    destinationSolBalance,
    ata: (owner, mint) => atas.get(`${owner}:${mint}`)!,
    tokenAccountRent: tokenRent,
    minSystemBalance: minSystem,
  })

  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()
  const wire = buildScalarSignedTransaction({
    feePayer: address(payment.address),
    scalar: payment.scalar,
    instructions: plan.instructions,
    blockhash,
  })
  const signature = await rpc
    .sendTransaction(wire as Parameters<typeof rpc.sendTransaction>[0], { encoding: 'base64', preflightCommitment: 'confirmed' })
    .send()
  await confirmSignature(signature)
  return { signature, plan }
}

