import { useQueryClient } from '@tanstack/react-query'
import { ImagePlus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { uploadNft } from '../api'
import { formatUnits } from '../lib/format'
import { friendlyError } from '../lib/errors'
import { buildMint, nftsKey } from '../nft/chain'
import Receipt from '../ui/Receipt'
import { confirmSignature, getRentExemption, getSolBalance } from '../wallet/rpc'
import { useWallet } from '../wallet/WalletContext'

const MAX_BYTES = 2 * 1024 * 1024
const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const NAME_MAX = 32
const DESC_MAX = 500
/** A Core NFT account is about 150 bytes plus its name and link; this is a safe upper estimate. */
const ASSET_BYTES = 260n
const BASE_FEE = 5_000n

type Phase = 'idle' | 'uploading' | 'signing' | 'confirming'

export default function MintNft() {
  const { service, accountIndex, address } = useWallet()
  const qc = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ nft: string; name: string; signature: string; cost: bigint } | null>(null)

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  const pick = (f: File | undefined) => {
    setError('')
    if (!f) return
    if (!TYPES.includes(f.type)) return setError('Use a PNG, JPEG, GIF or WebP picture.')
    if (f.size > MAX_BYTES) return setError('That picture is over 2 MB. Choose a smaller one.')
    setFile(f)
    if (!name) setName(f.name.replace(/\.[^.]+$/, '').slice(0, NAME_MAX))
  }

  const busy = phase !== 'idle'
  const nameBytes = new TextEncoder().encode(name.trim()).length

  const mint = async () => {
    if (!service || !address || !file) return
    setError('')
    if (nameBytes === 0 || nameBytes > NAME_MAX) return setError(`Give your NFT a name of 1 to ${NAME_MAX} characters.`)
    try {
      const [rent, balance] = await Promise.all([getRentExemption(ASSET_BYTES), getSolBalance(address)])
      if (balance < rent + BASE_FEE) {
        return setError(`Minting needs about ${formatUnits(rent + BASE_FEE, 9, 4)} SOL for storage and the network fee. Get some test SOL from the Wallet tab first.`)
      }
      setPhase('uploading')
      const { metadataUrl } = await uploadNft({ image: file, name: name.trim(), description: description.trim() })
      setPhase('signing')
      const { address: nft, instructions } = await buildMint({ payer: address, name: name.trim(), uri: metadataUrl })
      const { hash } = await service.sendInstructions(accountIndex, instructions)
      setPhase('confirming')
      await confirmSignature(hash)
      void qc.invalidateQueries({ queryKey: nftsKey(address) })
      // the public network's account scans can trail a moment behind: look again shortly
      setTimeout(() => void qc.invalidateQueries({ queryKey: nftsKey(address) }), 3_000)
      void qc.invalidateQueries({ queryKey: ['assets', address] })
      void qc.invalidateQueries({ queryKey: ['history', address] })
      setDone({ nft, name: name.trim(), signature: hash, cost: rent + BASE_FEE })
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setPhase('idle')
    }
  }

  const again = () => {
    setDone(null)
    setFile(null)
    setName('')
    setDescription('')
    setError('')
  }

  if (done) {
    return (
      <Receipt
        title="Minted"
        signature={done.signature}
        lines={[
          { label: 'NFT', value: done.name },
          { label: 'Owner', value: 'You' },
          { label: 'Cost', value: `about ${formatUnits(done.cost, 9, 4)} SOL` },
        ]}
      >
        <button className="btn-ghost flex-1" onClick={again}>
          Mint another
        </button>
        <Link to={`/nfts/${done.nft}`} className="btn-primary flex-1">
          View NFT
        </Link>
      </Receipt>
    )
  }

  const LABEL: Record<Phase, string> = { idle: 'Mint NFT', uploading: 'Uploading picture…', signing: 'Signing…', confirming: 'Confirming on Solana…' }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Turn a picture into an NFT that only you own. The picture is stored by this app’s server, and the NFT itself lives on Solana.
      </p>

      <div>
        <span className="label">Picture</span>
        <button
          type="button"
          className="group relative grid aspect-square w-full place-items-center overflow-hidden rounded-[6px] border border-dashed border-plate/60 bg-note text-plate transition hover:border-plate hover:bg-plate/4 disabled:opacity-60"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          aria-label={file ? 'Change picture' : 'Choose a picture'}
        >
          {preview ? (
            <img src={preview} alt="Preview of your NFT" className="absolute inset-0 size-full object-cover" />
          ) : (
            <span className="flex flex-col items-center gap-2 px-6 text-center">
              <ImagePlus className="size-8" aria-hidden />
              <span className="text-sm font-semibold">Choose a picture</span>
              <span className="text-xs text-muted">PNG, JPEG, GIF or WebP · up to 2 MB</span>
            </span>
          )}
        </button>
        <input ref={fileInput} type="file" accept={TYPES.join(',')} className="sr-only" tabIndex={-1} onChange={(e) => pick(e.target.files?.[0])} />
      </div>

      <div>
        <label className="label" htmlFor="nft-name">
          Name
        </label>
        <input id="nft-name" className="input" value={name} maxLength={NAME_MAX} disabled={busy} onChange={(e) => setName(e.target.value)} />
      </div>

      <div>
        <label className="label" htmlFor="nft-desc">
          Description <span className="font-normal">(optional)</span>
        </label>
        <textarea
          id="nft-desc"
          className="input h-24 resize-none"
          value={description}
          maxLength={DESC_MAX}
          disabled={busy}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      {error && (
        <p className="text-sm text-serial" role="alert">
          {error}
        </p>
      )}
      {busy && <div className="inking" role="status" aria-label={LABEL[phase]} />}
      <button className="btn-primary w-full" disabled={busy || !file || !name.trim()} onClick={mint}>
        {LABEL[phase]}
      </button>
      <p className="text-center text-xs text-muted">Costs about 0.003 test SOL for storage and the network fee.</p>
    </div>
  )
}
