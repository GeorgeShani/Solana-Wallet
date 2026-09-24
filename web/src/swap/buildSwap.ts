import { address } from '@solana/addresses'
import type { Instruction } from '@solana/instructions'
import {
  closeTokenAccount,
  createAssociatedTokenAccountIdempotent,
  derivePoolAddresses,
  findAssociatedTokenAddress,
  swapInstruction,
  syncNative,
  systemTransfer,
} from '@wallet/program-client'
import { WSOL_MINT, type SwapToken } from '@wallet/shared'

/**
 * Everything one swap needs, as a single atomic transaction:
 *  1. make sure the user has token accounts for both sides (no-op if they exist);
 *  2. if paying with SOL, wrap it (send lamports to the wSOL account, then sync);
 *  3. the swap itself;
 *  4. if SOL is on either side, close the wSOL account, which unwraps whatever is in it back to
 *     the wallet as plain SOL and refunds the account's rent.
 * Because it's one transaction, a failed swap (e.g. slippage) leaves the wallet exactly as it was.
 */
export async function buildSwapInstructions(input: {
  user: string
  tokenIn: SwapToken
  tokenOut: SwapToken
  amountIn: bigint
  minAmountOut: bigint
}): Promise<Instruction[]> {
  const user = address(input.user)
  const mintIn = address(input.tokenIn.mint)
  const mintOut = address(input.tokenOut.mint)
  const pool = await derivePoolAddresses(mintIn, mintOut)
  const [ataIn, ataOut] = await Promise.all([
    findAssociatedTokenAddress(user, mintIn),
    findAssociatedTokenAddress(user, mintOut),
  ])
  const aToB = pool.mintA === mintIn
  const paysSol = input.tokenIn.mint === WSOL_MINT
  const receivesSol = input.tokenOut.mint === WSOL_MINT

  const ixs: Instruction[] = [
    createAssociatedTokenAccountIdempotent({ payer: user, ata: ataIn, owner: user, mint: mintIn }),
    createAssociatedTokenAccountIdempotent({ payer: user, ata: ataOut, owner: user, mint: mintOut }),
  ]
  if (paysSol) ixs.push(systemTransfer({ from: user, to: ataIn, lamports: input.amountIn }), syncNative(ataIn))

  ixs.push(
    swapInstruction({
      user,
      pool,
      userA: aToB ? ataIn : ataOut,
      userB: aToB ? ataOut : ataIn,
      amountIn: input.amountIn,
      minAmountOut: input.minAmountOut,
      aToB,
    }),
  )

  if (paysSol || receivesSol) {
    ixs.push(closeTokenAccount({ account: paysSol ? ataIn : ataOut, destination: user, owner: user }))
  }
  return ixs
}
