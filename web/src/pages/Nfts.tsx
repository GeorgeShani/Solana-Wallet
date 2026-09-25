import { useQuery } from '@tanstack/react-query'
import { Plus, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { shortAddr } from '../lib/format'
import { fetchNfts, nftsKey } from '../nft/chain'
import NftImage from '../nft/NftImage'
import { Rosette } from '../ui/Guilloche'
import { useWallet } from '../wallet/WalletContext'

export default function Nfts() {
  const { address } = useWallet()
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: nftsKey(address),
    enabled: !!address,
    queryFn: () => fetchNfts(address!),
    staleTime: 15_000,
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">NFTs</h1>
        <div className="flex items-center gap-1">
          <button
            className="grid size-9 place-items-center rounded-[6px] text-plate hover:bg-plate/8 disabled:opacity-50"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label="Refresh NFTs"
            title="Refresh"
          >
            <RefreshCw className={`size-[18px] ${isFetching ? 'animate-spin' : ''}`} />
          </button>
          <Link to="/nfts/mint" className="btn-primary min-h-9! px-3! py-1.5!">
            <Plus className="size-4" aria-hidden /> Mint
          </Link>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted">Looking for your NFTs…</p>}
      {error && <p className="text-sm text-serial">Could not load your NFTs. The public network may be busy; try refreshing.</p>}

      {data?.length === 0 && (
        <div className="rise flex flex-col items-center py-8 text-center">
          <Rosette seed="empty nft shelf" layers={3} detail={70} draw className="mb-5 size-28 text-plate" />
          <h2 className="numeral text-2xl">Nothing collected yet</h2>
          <p className="mt-2 max-w-[32ch] text-sm text-muted">
            An NFT is a one-of-a-kind digital item that you own, like a collectible card. Make your first one from any picture.
          </p>
          <Link to="/nfts/mint" className="btn-primary mt-5">
            Mint your first NFT
          </Link>
        </div>
      )}

      {data && data.length > 0 && (
        <ul className="grid grid-cols-2 gap-4">
          {data.map((n) => (
            <li key={n.address} className="rise">
              <Link to={`/nfts/${n.address}`} className="group block no-underline">
                <NftImage address={n.address} uri={n.uri} name={n.name} className="transition group-hover:-translate-y-0.5" />
                <div className="mt-2 truncate text-sm font-semibold">{n.name}</div>
                <div className="serial text-[10px]">{shortAddr(n.address, 4)}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
