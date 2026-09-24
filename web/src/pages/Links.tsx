import { useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import CopyButton from '../components/CopyButton'
import { explorerTx, SYSTEM_ACCOUNT_SIZE } from '../config'
import { friendlyError } from '../lib/errors'
import { formatUnits, parseUnits, shortAddr } from '../lib/format'
import { buildCancelInstructions, buildCreateLinkInstructions, fetchMyLinks, type LinkInfo } from '../links/chain'
import { claimUrl, generateLinkSecret } from '../links/secret'
import { timeLeft, useTokenMeta } from '../links/useTokenMeta'
import { confirmSignature, getRentExemption } from '../wallet/rpc'
import { useAssets } from '../wallet/useAssets'
import { useWallet } from '../wallet/WalletContext'

const EXPIRY_CHOICES = [
  { label: '1 hour', seconds: 3_600 },
  { label: '24 hours', seconds: 86_400 },
  { label: '7 days', seconds: 7 * 86_400 },
  { label: '30 days', seconds: 30 * 86_400 },
]
/** SOL to keep back for fees and the escrow's refundable deposits. */
const SOL_RESERVE = 5_000_000n

interface Created {
  url: string
  amount: bigint
  symbol: string
  decimals: number
  expiry: number
  sig: string
}

export default function Links() {
  const { service, accountIndex, address } = useWallet()
  const { data: assets } = useAssets()
  const qc = useQueryClient()

  const [assetId, setAssetId] = useState('sol')
  const [amountText, setAmountText] = useState('')
  const [expiryChoice, setExpiryChoice] = useState(EXPIRY_CHOICES[2].seconds)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<Created | null>(null)

  const asset = assets?.find((a) => a.id === assetId)
  const sol = assets?.find((a) => a.id === 'sol')
  const links = useQuery({
    queryKey: ['links', address],
    enabled: !!address,
    refetchInterval: 15_000,
    queryFn: () => fetchMyLinks(address!),
  })

  const setMax = () => {
    if (!asset) return
    const max = asset.id === 'sol' ? (asset.balance > SOL_RESERVE ? asset.balance - SOL_RESERVE : 0n) : asset.balance
    setAmountText(formatUnits(max, asset.decimals))
  }

  const create = async () => {
    setError('')
    if (!service || !address || !asset || !sol) return
    const amount = parseUnits(amountText, asset.decimals)
    if (amount === null || amount <= 0n) return setError('Enter a valid amount.')
    if (amount > asset.balance) return setError(`Not enough ${asset.symbol}.`)
    setBusy(true)
    try {
      if (asset.id === 'sol') {
        const min = await getRentExemption(SYSTEM_ACCOUNT_SIZE)
        if (amount < min) return setError(`A SOL link needs at least ${formatUnits(min, 9)} SOL, so the recipient can open an account.`)
        if (amount + SOL_RESERVE > asset.balance) return setError('Keep about 0.005 SOL for fees and the refundable link deposit.')
      } else if (sol.balance < SOL_RESERVE) {
        return setError('You need about 0.005 SOL for fees and the refundable link deposit.')
      }

      const secret = await generateLinkSecret()
      const expiry = Math.floor(Date.now() / 1000) + expiryChoice
      const ixs = await buildCreateLinkInstructions({
        sender: address,
        mint: asset.id === 'sol' ? null : asset.id,
        claimKey: secret.claimKey,
        amount,
        expiry,
      })
      const { hash } = await service.sendInstructions(accountIndex, ixs)
      await confirmSignature(hash)
      setCreated({ url: claimUrl(secret.secret), amount, symbol: asset.symbol, decimals: asset.decimals, expiry, sig: hash })
      setAmountText('')
      void qc.invalidateQueries({ queryKey: ['assets', address] })
      void qc.invalidateQueries({ queryKey: ['links', address] })
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    return (
      <div className="space-y-4">
        <div className="card space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent2/15 text-2xl text-accent2">✓</div>
          <h2 className="text-lg font-semibold">
            Link ready: {formatUnits(created.amount, created.decimals)} {created.symbol}
          </h2>
          <div className="mx-auto w-fit rounded-2xl bg-white p-3">
            <QRCodeSVG value={created.url} size={160} />
          </div>
          <div className="flex items-center gap-2">
            <input readOnly aria-label="Claim link" className="input font-mono text-xs" value={created.url} onFocus={(e) => e.target.select()} />
            <CopyButton text={created.url} label="Copy link" />
          </div>
          <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-left text-xs text-amber-200">
            <b>Anyone with this link can claim the funds, so share it only with the person you mean it for.</b> It is
            shown once and is not stored anywhere, so copy it now. If it goes unclaimed you can cancel it below and get
            everything back.
          </p>
          <p className="text-xs text-muted">Expires {new Date(created.expiry * 1000).toLocaleString()}</p>
          <a className="block text-sm text-accent underline" href={explorerTx(created.sig)} target="_blank" rel="noreferrer">
            View on Solana Explorer
          </a>
          <button className="btn-ghost w-full" onClick={() => setCreated(null)}>
            Create another link
          </button>
        </div>
        <MyLinks links={links.data} loading={links.isLoading} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-4">
        <div>
          <h2 className="font-semibold">Send by link</h2>
          <p className="mt-1 text-xs text-muted">
            Lock funds behind a link. Whoever opens it can claim them to any address, so you don't need to know the
            recipient's address, and they don't need any SOL. The link (not your address) is the only thing you share.
          </p>
        </div>
        <div>
          <label className="label">Asset</label>
          <select className="input" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            {assets?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.symbol}: {formatUnits(a.balance, a.decimals, 6)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="flex items-end justify-between">
            <label className="label">Amount</label>
            <button type="button" className="mb-1.5 text-xs text-accent" onClick={setMax}>
              Max
            </button>
          </div>
          <input className="input" inputMode="decimal" placeholder="0.0" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
        </div>
        <div>
          <label className="label">Link expires after</label>
          <div className="flex flex-wrap gap-2">
            {EXPIRY_CHOICES.map((c) => (
              <button
                key={c.seconds}
                type="button"
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  expiryChoice === c.seconds ? 'border-accent bg-accent/15' : 'border-line hover:bg-white/5'
                }`}
                onClick={() => setExpiryChoice(c.seconds)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">After this it can't be claimed, but you can always cancel it and get your funds back.</p>
        </div>
        <p className="rounded-lg bg-white/5 p-3 text-xs text-muted">
          A small deposit (about 0.003 SOL) is held while the link is open and returned when it is claimed or cancelled.
        </p>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button className="btn-primary w-full" disabled={busy || !amountText || !asset} onClick={create}>
          {busy ? 'Creating link…' : 'Create link'}
        </button>
      </div>
      <MyLinks links={links.data} loading={links.isLoading} />
    </div>
  )
}

function MyLinks({ links, loading }: { links?: LinkInfo[]; loading: boolean }) {
  return (
    <div className="card">
      <h2 className="mb-3 text-sm font-semibold">Your open links</h2>
      {loading && <p className="text-sm text-muted">Loading…</p>}
      {links?.length === 0 && (
        <p className="text-sm text-muted">No open links. Claimed and cancelled links disappear from this list.</p>
      )}
      <ul className="divide-y divide-line">
        {links?.map((l) => <LinkRow key={l.claim} link={l} />)}
      </ul>
    </div>
  )
}

function LinkRow({ link }: { link: LinkInfo }) {
  const { service, accountIndex, address } = useWallet()
  const qc = useQueryClient()
  const { data: meta } = useTokenMeta(link.mint)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const status = timeLeft(link.expiry)
  const expired = status === 'Expired'

  const cancel = async () => {
    if (!service) return
    setBusy(true)
    setError('')
    try {
      const { hash } = await service.sendInstructions(accountIndex, await buildCancelInstructions(link))
      await confirmSignature(hash)
      void qc.invalidateQueries({ queryKey: ['links', address] })
      void qc.invalidateQueries({ queryKey: ['assets', address] })
    } catch (e) {
      setError(friendlyError(e))
      setBusy(false)
    }
  }

  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{meta ? `${formatUnits(link.amount, meta.decimals, 6)} ${meta.symbol}` : '…'}</div>
          <div className={`text-xs ${expired ? 'text-amber-300' : 'text-muted'}`}>
            {status} · {shortAddr(link.claimKey, 4)}
          </div>
        </div>
        {!confirming ? (
          <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setConfirming(true)}>
            Cancel link
          </button>
        ) : (
          <div className="flex gap-2">
            <button className="btn-ghost !px-3 !py-1.5 text-xs" disabled={busy} onClick={() => setConfirming(false)}>
              Keep
            </button>
            <button className="btn-danger !px-3 !py-1.5 text-xs" disabled={busy} onClick={cancel}>
              {busy ? 'Cancelling…' : 'Yes, cancel'}
            </button>
          </div>
        )}
      </div>
      {confirming && !busy && (
        <p className="mt-2 text-xs text-muted">The link stops working and the funds return to your wallet.</p>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </li>
  )
}
