import { useState } from 'react'
import { Rosette } from '../ui/Guilloche'
import { useNftDetails } from './useNftDetails'

/**
 * The NFT's picture, framed like a small note. While it loads, or if it can't be reached, the
 * NFT's own rosette stands in, so every NFT is always recognisable.
 */
export default function NftImage({ address, uri, name, className = '' }: { address: string; uri: string; name: string; className?: string }) {
  const { data } = useNftDetails(uri)
  const [failed, setFailed] = useState(false)
  const src = !failed ? data?.image : null
  return (
    <div className={`relative aspect-square overflow-hidden rounded-[4px] bg-note text-plate ring-1 ring-plate/60 ${className}`}>
      <Rosette seed={address} layers={3} detail={40} className="absolute inset-0 size-full opacity-60" />
      {src && (
        <img
          src={src}
          alt={name}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
      <span className="pointer-events-none absolute inset-[5px] rounded-[2px] border border-white/55 mix-blend-plus-lighter" aria-hidden />
    </div>
  )
}
