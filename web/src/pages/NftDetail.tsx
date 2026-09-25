import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { explorerAddress } from '../config'
import { friendlyError } from '../lib/errors'
import { shortAddr } from '../lib/format'
import { buildSend, fetchNfts, nftsKey } from '../nft/chain'
import NftImage from '../nft/NftImage'
import { useNftDetails } from '../nft/useNftDetails'
import Receipt from '../ui/Receipt'
import { confirmSignature, getSolBalance, validAddress } from '../wallet/rpc'
import { useWallet } from '../wallet/WalletContext'
import { address as toAddress } from '@solana/addresses'

const MIN_SOL = 10_000n

export default function NftDetail() {
  const { address: nftAddress = '' } = useParams()
  const { service, accountIndex, address } = useWallet()
  const qc = useQueryClient()
  const list = useQuery({ queryKey: nftsKey(address), enabled: !!address, queryFn: () => fetchNfts(address!), staleTime: 15_000 })
  const nft = list.data?.find((n) => n.address === nftAddress)
  const details = useNftDetails(nft?.uri ?? '')

  const [to, setTo] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState<{ signature: string; to: string; name: string } | null>(null)

  if (sent) {
    return (
      <Receipt
        title="Sent"
        signature={sent.signature}
        lines={[
          { label: 'NFT', value: sent.name },
          { label: 'To', value: <span className="serial break-all">{shortAddr(sent.to, 6)}</span> },
        ]}
      >
        <Link to="/nfts" className="btn-primary flex-1">
          Back to my NFTs
        </Link>
      </Receipt>
    )
  }

  if (!nft) {
    return list.isLoading ? (
      <p className="text-sm text-muted">Loading…</p>
    ) : (
      <div className="space-y-3 py-6 text-center">
        <p className="text-sm text-muted">This NFT isn’t in your wallet. It may have been sent somewhere else.</p>
        <Link to="/nfts" className="btn-ghost">
          Back to my NFTs
        </Link>
      </div>
    )
  }

  const review = async () => {
    setError('')
    const dest = to.trim()
    if (!validAddress(dest)) return setError('That is not a valid Solana address.')
    if (dest === address) return setError('That is your own address.')
    if (!address || (await getSolBalance(address)) < MIN_SOL) return setError('You need a little SOL to pay the network fee. Get some from the Wallet tab.')
    setReviewing(true)
  }

  const send = async () => {
    if (!service || !address) return
    setBusy(true)
    setError('')
    try {
      const { hash } = await service.sendInstructions(accountIndex, buildSend({ nft: toAddress(nft.address), from: address, to: to.trim() }))
      await confirmSignature(hash)
      void qc.invalidateQueries({ queryKey: nftsKey(address) })
      // the public network's account scans can trail a moment behind: look again shortly
      setTimeout(() => void qc.invalidateQueries({ queryKey: nftsKey(address) }), 3_000)
      void qc.invalidateQueries({ queryKey: ['history', address] })
      setSent({ signature: hash, to: to.trim(), name: nft.name })
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <NftImage address={nft.address} uri={nft.uri} name={nft.name} className="rise" />

      <div>
        <h2 className="numeral text-[30px] leading-tight">{nft.name}</h2>
        {details.data?.description && <p className="mt-2 text-sm whitespace-pre-line text-muted">{details.data.description}</p>}
        <p className="mt-3 flex items-center gap-3">
          <span className="serial">Nº {shortAddr(nft.address, 6)}</span>
          <a className="link inline-flex items-center gap-1 text-[13px]" href={explorerAddress(nft.address)} target="_blank" rel="noreferrer">
            Explorer <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </p>
      </div>

      <hr className="rule" />

      <section className="space-y-3">
        <h3 className="font-semibold">Send this NFT</h3>
        {!reviewing ? (
          <>
            <div>
              <label className="label" htmlFor="nft-to">
                Recipient address
              </label>
              <input id="nft-to" className="input font-serial text-[13px]" placeholder="Solana address" autoComplete="off" spellCheck={false} value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            {error && (
              <p className="text-sm text-serial" role="alert">
                {error}
              </p>
            )}
            <button className="btn-ghost w-full" disabled={!to.trim()} onClick={() => void review()}>
              Review
            </button>
          </>
        ) : (
          <>
            <p className="text-sm">
              Send <b>{nft.name}</b> to <span className="serial break-all">{to.trim()}</span>? Once it’s sent, only the new owner can send it back.
            </p>
            {error && (
              <p className="text-sm text-serial" role="alert">
                {error}
              </p>
            )}
            {busy && <div className="inking" role="status" aria-label="Sending" />}
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" disabled={busy} onClick={() => setReviewing(false)}>
                Back
              </button>
              <button className="btn-primary flex-1" disabled={busy} onClick={() => void send()}>
                {busy ? 'Sending…' : 'Confirm & send'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
