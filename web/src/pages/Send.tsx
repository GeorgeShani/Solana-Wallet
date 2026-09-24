import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { explorerTx, SYSTEM_ACCOUNT_SIZE, TOKEN_ACCOUNT_SIZE } from '../config'
import { formatUnits, parseUnits, shortAddr } from '../lib/format'
import { friendlyError } from '../lib/errors'
import { confirmSignature, getRentExemption, getSolBalance, hasTokenAccount, validAddress } from '../wallet/rpc'
import { useAssets, type Asset } from '../wallet/useAssets'
import { useWallet } from '../wallet/WalletContext'

interface Review {
  asset: Asset
  to: string
  amount: bigint
  fee: bigint
  /** Rent the sender pays to create the recipient's token account (0 if it already exists). */
  accountRent: bigint
}

const BASE_FEE = 5_000n

export default function Send() {
  const { service, accountIndex, address } = useWallet()
  const { data: assets } = useAssets()
  const qc = useQueryClient()

  const [assetId, setAssetId] = useState('sol')
  const [to, setTo] = useState('')
  const [amountText, setAmountText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [review, setReview] = useState<Review | null>(null)
  const [sig, setSig] = useState<string | null>(null)

  const asset = assets?.find((a) => a.id === assetId)

  const setMax = () => {
    if (!asset) return
    const max = asset.id === 'sol' ? (asset.balance > BASE_FEE ? asset.balance - BASE_FEE : 0n) : asset.balance
    setAmountText(formatUnits(max, asset.decimals))
  }

  const prepare = async () => {
    setError('')
    if (!service || !asset || !address) return
    const recipient = to.trim()
    if (!validAddress(recipient)) return setError('That is not a valid Solana address.')
    if (recipient === address) return setError("You can't send to your own address.")
    const amount = parseUnits(amountText, asset.decimals)
    if (amount === null || amount <= 0n) return setError('Enter a valid amount.')
    if (amount > asset.balance) return setError(`Not enough ${asset.symbol}.`)

    setBusy(true)
    try {
      if (asset.id === 'sol') {
        const [fee, recipientBal, minBalance] = await Promise.all([
          service.quoteSendSol(accountIndex, recipient, amount),
          getSolBalance(recipient),
          getRentExemption(SYSTEM_ACCOUNT_SIZE),
        ])
        if (amount + fee > asset.balance) return setError('Not enough SOL to cover the amount plus the network fee.')
        if (recipientBal === 0n && amount < minBalance) {
          return setError(
            `New accounts need at least ${formatUnits(minBalance, 9)} SOL to exist on Solana. Send a bit more.`,
          )
        }
        setReview({ asset, to: recipient, amount, fee, accountRent: 0n })
      } else {
        const [fee, solBal, exists, tokenRent] = await Promise.all([
          service.quoteTransferToken(accountIndex, asset.id, recipient, amount),
          getSolBalance(address),
          hasTokenAccount(recipient, asset.id),
          getRentExemption(TOKEN_ACCOUNT_SIZE),
        ])
        const rent = exists ? 0n : tokenRent
        if (solBal < fee + rent) {
          return setError(
            `You need about ${formatUnits(fee + rent, 9)} SOL to pay the network fee${exists ? '' : " and create the recipient's token account"}.`,
          )
        }
        setReview({ asset, to: recipient, amount, fee, accountRent: rent })
      }
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!review || !service) return
    setBusy(true)
    setError('')
    try {
      const res =
        review.asset.id === 'sol'
          ? await service.sendSol(accountIndex, review.to, review.amount)
          : await service.transferToken(accountIndex, review.asset.id, review.to, review.amount)
      await confirmSignature(res.hash)
      setSig(res.hash)
      void qc.invalidateQueries({ queryKey: ['assets', address] })
      void qc.invalidateQueries({ queryKey: ['history', address] })
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    setReview(null)
    setSig(null)
    setTo('')
    setAmountText('')
    setError('')
  }

  if (sig && review) {
    return (
      <div className="card space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent2/15 text-2xl text-accent2">✓</div>
        <h2 className="text-lg font-semibold">Sent</h2>
        <p className="text-sm text-muted">
          {formatUnits(review.amount, review.asset.decimals)} {review.asset.symbol} to {shortAddr(review.to, 6)}
        </p>
        <a className="block text-sm text-accent underline" href={explorerTx(sig)} target="_blank" rel="noreferrer">
          View on Solana Explorer
        </a>
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={reset}>
            Send another
          </button>
          <Link to="/" className="btn-primary flex-1">
            Done
          </Link>
        </div>
      </div>
    )
  }

  if (review) {
    const isSol = review.asset.id === 'sol'
    const createsAccount = review.accountRent > 0n
    const totalSol = (isSol ? review.amount : 0n) + review.fee + review.accountRent
    return (
      <div className="card space-y-4">
        <h2 className="font-semibold">Review</h2>
        <dl className="space-y-3 text-sm">
          <Row k="Amount" v={`${formatUnits(review.amount, review.asset.decimals)} ${review.asset.symbol}`} />
          <Row k="To" v={<span className="break-all font-mono text-xs">{review.to}</span>} />
          <Row k="Network fee" v={`${formatUnits(review.fee, 9)} SOL`} />
          {createsAccount && <Row k="New token account" v={`${formatUnits(review.accountRent, 9)} SOL`} />}
          <div className="border-t border-line pt-3">
            <Row k="Total SOL out" v={<b>{formatUnits(totalSol, 9)} SOL</b>} />
          </div>
        </dl>
        {createsAccount && (
          <p className="rounded-lg bg-white/5 p-3 text-xs text-muted">
            The recipient doesn't have a {review.asset.symbol} account yet, so this transfer creates one. That one-time
            rent deposit is paid by you.
          </p>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" disabled={busy} onClick={() => setReview(null)}>
            Back
          </button>
          <button className="btn-primary flex-1" disabled={busy} onClick={confirm}>
            {busy ? 'Sending…' : 'Confirm & send'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="card space-y-4">
      <h2 className="font-semibold">Send</h2>
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
        <label className="label">Recipient address</label>
        <input
          className="input font-mono"
          placeholder="Solana address"
          autoComplete="off"
          spellCheck={false}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      <div>
        <div className="flex items-end justify-between">
          <label className="label">Amount</label>
          <button type="button" className="mb-1.5 text-xs text-accent" onClick={setMax}>
            Max
          </button>
        </div>
        <input
          className="input"
          inputMode="decimal"
          placeholder="0.0"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button className="btn-primary w-full" disabled={busy || !to || !amountText || !asset} onClick={prepare}>
        {busy ? 'Checking…' : 'Review'}
      </button>
    </div>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  )
}
