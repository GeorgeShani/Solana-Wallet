import { useQuery } from '@tanstack/react-query'
import { explorerTx, tokenByMint } from '../config'
import { formatUnits, shortAddr } from '../lib/format'
import { getHistory } from '../wallet/rpc'
import { useWallet } from '../wallet/WalletContext'

export default function Activity() {
  const { address } = useWallet()
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['history', address],
    enabled: !!address,
    queryFn: () => getHistory(address!),
  })

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Recent activity</h2>
        <button className="text-xs text-accent" onClick={() => void refetch()} disabled={isFetching}>
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {isLoading && <p className="text-sm text-muted">Loading…</p>}
      {error && <p className="text-sm text-red-400">Could not load activity. The public RPC may be rate-limiting; try again.</p>}
      {data?.length === 0 && <p className="text-sm text-muted">No transactions yet.</p>}
      <ul className="divide-y divide-line">
        {data?.map((h) => {
          const tok = h.tokenDeltas[0]
          const info = tok ? tokenByMint(tok.mint) : undefined
          const amount = tok
            ? `${tok.delta > 0n ? '+' : ''}${formatUnits(tok.delta, tok.decimals, 6)} ${info?.symbol ?? shortAddr(tok.mint, 3)}`
            : `${h.solDelta > 0n ? '+' : ''}${formatUnits(h.solDelta, 9, 6)} SOL`
          const label = h.failed ? 'Failed' : h.kind === 'sent' ? 'Sent' : h.kind === 'received' ? 'Received' : 'Interaction'
          return (
            <li key={h.signature} className="flex items-center justify-between py-3">
              <div>
                <div className={`text-sm font-medium ${h.failed ? 'text-red-400' : ''}`}>{label}</div>
                <a
                  className="text-xs text-muted underline decoration-dotted"
                  href={explorerTx(h.signature)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {h.blockTime ? new Date(h.blockTime * 1000).toLocaleString() : shortAddr(h.signature, 6)}
                </a>
              </div>
              <div className={`text-sm font-medium ${h.kind === 'received' && !h.failed ? 'text-accent2' : ''}`}>
                {h.failed ? '—' : amount}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
