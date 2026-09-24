import { useQuery } from '@tanstack/react-query'
import { SOL_DECIMALS, tokenByMint } from '../config'
import { shortAddr } from '../lib/format'
import { getAccountsData } from '../wallet/rpc'

export interface TokenMeta {
  symbol: string
  decimals: number
}

/** Symbol and decimals for a link's asset (null mint = SOL). Unknown tokens read decimals from the mint. */
export function useTokenMeta(mint: string | null) {
  return useQuery({
    queryKey: ['tokenMeta', mint],
    staleTime: Infinity,
    queryFn: async (): Promise<TokenMeta> => {
      if (mint === null) return { symbol: 'SOL', decimals: SOL_DECIMALS }
      const known = tokenByMint(mint)
      if (known) return { symbol: known.symbol, decimals: known.decimals }
      const [data] = await getAccountsData([mint])
      return { symbol: shortAddr(mint, 3), decimals: data ? data[44] : 0 } // decimals is byte 44 of a mint
    },
  })
}

/** "6d 23h left", "45m left", or "Expired". */
export function timeLeft(expiryUnix: bigint | number, nowMs = Date.now()): string {
  const secs = Number(expiryUnix) - Math.floor(nowMs / 1000)
  if (secs <= 0) return 'Expired'
  const d = Math.floor(secs / 86_400)
  const h = Math.floor((secs % 86_400) / 3_600)
  const m = Math.floor((secs % 3_600) / 60)
  if (d > 0) return `${d}d ${h}h left`
  if (h > 0) return `${h}h ${m}m left`
  return `${Math.max(m, 1)}m left`
}
