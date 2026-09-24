import { useQuery } from '@tanstack/react-query'
import { KNOWN_TOKENS, SOL_DECIMALS, tokenByMint } from '../config'
import { shortAddr } from '../lib/format'
import { getSolBalance, getTokenHoldings } from './rpc'
import { useWallet } from './WalletContext'

export interface Asset {
  /** 'sol' for native SOL, otherwise the token mint address. */
  id: string
  symbol: string
  name: string
  decimals: number
  balance: bigint
  isKnown: boolean
}

export function useAssets() {
  const { address } = useWallet()
  const query = useQuery({
    queryKey: ['assets', address],
    enabled: !!address,
    refetchInterval: 15_000,
    queryFn: async (): Promise<Asset[]> => {
      const [sol, holdings] = await Promise.all([getSolBalance(address!), getTokenHoldings(address!)])
      const byMint = new Map<string, bigint>()
      const decimalsByMint = new Map<string, number>()
      for (const h of holdings) {
        byMint.set(h.mint, (byMint.get(h.mint) ?? 0n) + h.amount)
        decimalsByMint.set(h.mint, h.decimals)
      }
      const assets: Asset[] = [
        { id: 'sol', symbol: 'SOL', name: 'Solana', decimals: SOL_DECIMALS, balance: sol, isKnown: true },
      ]
      // Known tokens are always listed (even at zero); unknown ones only if held.
      for (const t of KNOWN_TOKENS) {
        assets.push({
          id: t.mint,
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          balance: byMint.get(t.mint) ?? 0n,
          isKnown: true,
        })
      }
      for (const [mint, balance] of byMint) {
        if (tokenByMint(mint) || balance === 0n) continue
        assets.push({
          id: mint,
          symbol: shortAddr(mint, 3),
          name: 'Unknown token',
          decimals: decimalsByMint.get(mint) ?? 0,
          balance,
          isKnown: false,
        })
      }
      return assets
    },
  })
  return query
}
