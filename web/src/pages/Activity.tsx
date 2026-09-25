import { useQuery } from '@tanstack/react-query'
import { WSOL_MINT } from '@wallet/shared'
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, RefreshCw, Zap } from 'lucide-react'
import { explorerTx, tokenByMint } from '../config'
import { formatUnits, shortAddr } from '../lib/format'
import { getHistory, type HistoryItem } from '../wallet/rpc'
import { useWallet } from '../wallet/WalletContext'

type Delta = HistoryItem['tokenDeltas'][number]

function fmt(t: Delta): string {
  const symbol = t.mint === WSOL_MINT ? 'SOL' : (tokenByMint(t.mint)?.symbol ?? shortAddr(t.mint, 3))
  return `${t.delta > 0n ? '+' : ''}${formatUnits(t.delta, t.decimals, 6)} ${symbol}`
}

function describe(h: HistoryItem): { label: string; amount: string } {
  if (h.failed) return { label: 'Failed', amount: '—' }
  // nothing known about it (the network didn't hand over the details): say so instead of "0 SOL"
  if (h.kind === 'other' && !h.label && h.tokenDeltas.length === 0 && h.solDelta === 0n) return { label: 'Transaction', amount: 'Details unavailable' }
  if (h.kind === 'swap') {
    // spent leg first, received leg second
    const legs = [...h.tokenDeltas].sort((a, b) => (a.delta < b.delta ? -1 : 1))
    return { label: h.label ?? 'Swap', amount: legs.map(fmt).join(' → ') }
  }
  const tok = h.tokenDeltas[0]
  const amount = tok ? fmt(tok) : `${h.solDelta > 0n ? '+' : ''}${formatUnits(h.solDelta, 9, 6)} SOL`
  const label = h.label ?? (h.kind === 'sent' ? 'Sent' : h.kind === 'received' ? 'Received' : 'Interaction')
  return { label, amount }
}

const ICONS = { sent: ArrowUpRight, received: ArrowDownLeft, swap: ArrowLeftRight } as const

export default function Activity() {
  const { address } = useWallet()
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['history', address],
    enabled: !!address,
    queryFn: () => getHistory(address!),
  })

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Activity</h1>
        <button
          className="grid size-9 place-items-center rounded-[6px] text-plate hover:bg-plate/8 disabled:opacity-50"
          onClick={() => void refetch()}
          disabled={isFetching}
          aria-label="Refresh activity"
          title="Refresh"
        >
          <RefreshCw className={`size-[18px] ${isFetching ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {isLoading && <p className="py-3 text-sm text-muted">Loading your transactions…</p>}
      {error && <p className="py-3 text-sm text-serial">Could not load activity. The public network may be busy; try again in a moment.</p>}
      {data?.length === 0 && (
        <p className="py-6 text-center text-sm text-muted">Nothing here yet. Your sends, receives and swaps will show up as they happen.</p>
      )}
      <ul className="divide-y divide-line border-y border-line">
        {data?.map((h) => {
          const { label, amount } = describe(h)
          const Icon = h.kind in ICONS ? ICONS[h.kind as keyof typeof ICONS] : Zap
          return (
            <li key={h.signature} className="flex items-center gap-3 py-3">
              <span
                className={`grid size-9 shrink-0 place-items-center rounded-full border ${h.failed ? 'border-serial text-serial' : 'border-plate/50 text-plate'}`}
              >
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-semibold ${h.failed ? 'text-serial' : ''}`}>{label}</div>
                <a className="link text-xs! font-normal! text-muted!" href={explorerTx(h.signature)} target="_blank" rel="noreferrer">
                  {h.blockTime ? new Date(h.blockTime * 1000).toLocaleString() : shortAddr(h.signature, 6)}
                </a>
              </div>
              <div className={`num text-right text-sm font-semibold ${h.kind === 'received' && !h.failed ? 'text-ok' : ''}`}>{amount}</div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
