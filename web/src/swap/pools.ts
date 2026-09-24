import { useQuery } from '@tanstack/react-query'
import { decodeTokenAmount } from '@wallet/program-client'
import { DEVNET, minAmountOut, priceImpactBps, swapOutput, type PoolConfig, type SwapToken } from '@wallet/shared'
import { getAccountsData } from '../wallet/rpc'

export interface LivePool extends PoolConfig {
  reserveA: bigint
  reserveB: bigint
}

/** Reserves of every configured pool (the balances of their vault token accounts). */
export function usePools() {
  return useQuery({
    queryKey: ['pools'],
    refetchInterval: 10_000,
    queryFn: async (): Promise<LivePool[]> => {
      const vaults = DEVNET.pools.flatMap((p) => [p.vaultA, p.vaultB])
      const data = await getAccountsData(vaults)
      return DEVNET.pools.map((p, i) => ({
        ...p,
        reserveA: data[i * 2] ? decodeTokenAmount(data[i * 2]!) : 0n,
        reserveB: data[i * 2 + 1] ? decodeTokenAmount(data[i * 2 + 1]!) : 0n,
      }))
    },
  })
}

export interface Route {
  pool: LivePool
  /** True if the input token is the pool's mint A. */
  aToB: boolean
}

/** The pool trading `mintIn` for `mintOut`, if we have one. */
export function findRoute(pools: LivePool[], mintIn: string, mintOut: string): Route | null {
  for (const pool of pools) {
    if (pool.mintA === mintIn && pool.mintB === mintOut) return { pool, aToB: true }
    if (pool.mintB === mintIn && pool.mintA === mintOut) return { pool, aToB: false }
  }
  return null
}

export interface SwapQuote {
  amountIn: bigint
  amountOut: bigint
  /** Least the user will accept; the program reverts the trade below this. */
  minOut: bigint
  impactBps: number
  reserveIn: bigint
  reserveOut: bigint
}

/** Quote a trade against current reserves. Returns null when the pool can't fill it. */
export function quoteSwap(route: Route, amountIn: bigint, slippageBps: number): SwapQuote | null {
  const { pool, aToB } = route
  const [reserveIn, reserveOut] = aToB ? [pool.reserveA, pool.reserveB] : [pool.reserveB, pool.reserveA]
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return null
  const amountOut = swapOutput(reserveIn, reserveOut, amountIn, pool.feeBps)
  if (amountOut <= 0n) return null
  return {
    amountIn,
    amountOut,
    minOut: minAmountOut(amountOut, slippageBps),
    impactBps: priceImpactBps(reserveIn, reserveOut, amountIn, amountOut),
    reserveIn,
    reserveOut,
  }
}

export const SWAP_TOKENS: SwapToken[] = DEVNET.tokens
