import { useQuery, useQueryClient } from '@tanstack/react-query'
import { decodeMetaAddress, encodeMetaAddress, type MetaAddress, type StealthKeys } from '@wallet/shared'
import { QRCodeSVG } from 'qrcode.react'
import { useMemo, useState } from 'react'
import CopyButton from '../components/CopyButton'
import { explorerAddress, explorerTx, SYSTEM_ACCOUNT_SIZE, TOKEN_ACCOUNT_SIZE, tokenByMint } from '../config'
import { friendlyError } from '../lib/errors'
import { formatUnits, parseUnits, shortAddr } from '../lib/format'
import Receipt from '../ui/Receipt'
import { useToast } from '../ui/toastContext'
import { FEE_MARGIN_LAMPORTS, planStealthPayment } from '../stealth/pay'
import { scanFeed, type FoundPayment } from '../stealth/scan'
import { sweepStealthAddress } from '../stealth/spend'
import { confirmSignature, getRentExemption, getSolBalance, getTokenHoldings, validAddress } from '../wallet/rpc'
import { useAssets } from '../wallet/useAssets'
import { useWallet } from '../wallet/WalletContext'

export default function Stealth() {
  const { service, addresses } = useWallet()
  // One stealth identity per recovery phrase, shared by all accounts. Query keys start with
  // 'stealth' so locking the wallet can wipe them (they hold private keys).
  const keys = useQuery({
    queryKey: ['stealth', 'keys', addresses[0]],
    enabled: !!service,
    staleTime: Infinity,
    retry: false,
    queryFn: () => service!.getStealthKeys(),
  })

  return (
    <div className="space-y-7">
      <MyStealthAddress meta={keys.data ? encodeMetaAddress(keys.data.spendPub, keys.data.scanPub) : null} error={keys.error} />
      <PayPrivately />
      {keys.data && <Incoming keys={keys.data} />}
    </div>
  )
}

function MyStealthAddress({ meta, error }: { meta: string | null; error: unknown }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold">Your stealth address</h2>
        <p className="mt-1 text-[13px] text-muted">
          Share this instead of your normal address. Every payment sent to it lands at a brand-new one-time address that
          nobody can connect to you, and only your wallet can find and spend it.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-serial">Could not derive your stealth keys: {friendlyError(error)}</p>
      ) : !meta ? (
        <p className="text-sm text-muted">Deriving your keys…</p>
      ) : (
        <>
          <div className="flex gap-3">
            <div className="shrink-0 rounded-[4px] bg-white p-2 ring-1 ring-plate/60">
              <QRCodeSVG value={meta} size={104} fgColor="#052a2d" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="break-all rounded-[6px] border border-line bg-note p-2 font-serial text-[11px] leading-snug" aria-label="Your stealth address">
                {meta}
              </p>
              <CopyButton text={meta} label="Copy stealth address" />
            </div>
          </div>
          <p className="text-xs text-muted">
            It's safe to publish: it lets people pay you, but not see or spend anything. It is the same for every account
            of this wallet.
          </p>
        </>
      )}
    </section>
  )
}

function PayPrivately() {
  const { service, accountIndex, address } = useWallet()
  const { data: assets } = useAssets()
  const qc = useQueryClient()

  const [to, setTo] = useState('')
  const [assetId, setAssetId] = useState('sol')
  const [amountText, setAmountText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ sig: string; text: string; stealth: string } | null>(null)

  const asset = assets?.find((a) => a.id === assetId)
  const sol = assets?.find((a) => a.id === 'sol')

  const parsed = useMemo<{ meta?: MetaAddress; problem?: string }>(() => {
    if (!to.trim()) return {}
    try {
      return { meta: decodeMetaAddress(to) }
    } catch (e) {
      return { problem: e instanceof Error ? e.message : 'Not a valid stealth address' }
    }
  }, [to])

  const send = async () => {
    setError('')
    if (!service || !address || !asset || !sol || !parsed.meta) return
    const amount = parseUnits(amountText, asset.decimals)
    if (amount === null || amount <= 0n) return setError('Enter a valid amount.')
    if (amount > asset.balance) return setError(`Not enough ${asset.symbol}.`)

    setBusy(true)
    try {
      const [tokenRent, minSystem] = await Promise.all([getRentExemption(TOKEN_ACCOUNT_SIZE), getRentExemption(SYSTEM_ACCOUNT_SIZE)])
      if (asset.id === 'sol') {
        if (amount < minSystem) {
          return setError(`A private SOL payment must be at least ${formatUnits(minSystem, 9)} SOL: the one-time address needs that much to exist.`)
        }
        if (amount + 20_000n > asset.balance) return setError('Keep a little SOL for the network fee.')
      } else {
        // the token account for the one-time address, plus the SOL that lets it pay its own fees
        const need = tokenRent * 2n + FEE_MARGIN_LAMPORTS + 20_000n
        if (sol.balance < need) return setError(`You need about ${formatUnits(need, 9)} SOL to cover the new token account and gas for the recipient.`)
      }

      const plan = await planStealthPayment({
        sender: address,
        meta: parsed.meta,
        mint: asset.id === 'sol' ? null : asset.id,
        decimals: asset.decimals,
        amount,
        tokenAccountRent: tokenRent,
      })
      const { hash } = await service.sendInstructions(accountIndex, plan.instructions)
      await confirmSignature(hash)
      setDone({ sig: hash, stealth: plan.stealthAddress, text: `${formatUnits(amount, asset.decimals)} ${asset.symbol}` })
      setAmountText('')
      void qc.invalidateQueries({ queryKey: ['assets', address] })
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Receipt
        title="Sent privately"
        signature={done.sig}
        lines={[
          { label: 'Amount', value: done.text },
          { label: 'Paid to', value: <span className="serial break-all">{shortAddr(done.stealth, 6)}</span> },
        ]}
      >
        <button className="btn-primary flex-1" onClick={() => setDone(null)}>
          Send another
        </button>
      </Receipt>
    )
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-semibold">Pay privately</h2>
        <p className="mt-1 text-[13px] text-muted">
          Paste someone's stealth address. Your payment goes to a fresh one-time address, so onlookers can't tell who
          received it. (You'll still be visible as the sender.)
        </p>
      </div>
      <div>
        <label className="label" htmlFor="stealth-to">
          Their stealth address
        </label>
        <textarea
          id="stealth-to"
          className="input h-20 resize-none font-serial text-xs"
          placeholder="stealth:…"
          autoComplete="off"
          spellCheck={false}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        {parsed.problem && <p className="mt-1.5 text-xs text-serial">{parsed.problem}</p>}
        {parsed.meta && <p className="mt-1.5 text-xs text-ok">Valid stealth address ✓</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
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
          <label className="label">Amount</label>
          <input className="input" inputMode="decimal" placeholder="0.0" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
        </div>
      </div>
      {asset && asset.id !== 'sol' && (
        <p className="rounded-[6px] bg-plate/6 p-3 text-xs text-muted">
          Token payments also open a token account for the one-time address and send about 0.003 SOL with it, so the
          recipient can move the tokens later without needing any SOL of their own.
        </p>
      )}
      {error && (
        <p className="text-sm text-serial" role="alert">
          {error}
        </p>
      )}
      <button className="btn-primary w-full" disabled={busy || !parsed.meta || !amountText || !asset} onClick={send}>
        {busy ? 'Sending…' : 'Send privately'}
      </button>
    </section>
  )
}

interface Holdings {
  payment: FoundPayment
  sol: bigint
  tokens: { mint: string; amount: bigint; decimals: number }[]
}

function Incoming({ keys }: { keys: StealthKeys }) {
  const { address } = useWallet()
  const qc = useQueryClient()
  const [destination, setDestination] = useState('')

  const feed = useQuery({
    queryKey: ['stealth', 'feed', address],
    refetchInterval: 20_000,
    retry: 1,
    queryFn: () => scanFeed(keys),
  })

  const holdings = useQuery({
    queryKey: ['stealth', 'holdings', feed.data?.payments.map((p) => p.address).join(',')],
    enabled: !!feed.data && feed.data.payments.length > 0,
    refetchInterval: 20_000,
    queryFn: async (): Promise<Holdings[]> =>
      Promise.all(
        feed.data!.payments.map(async (payment) => {
          const [sol, tokens] = await Promise.all([getSolBalance(payment.address), getTokenHoldings(payment.address)])
          return { payment, sol, tokens: tokens.filter((t) => t.amount > 0n) }
        }),
      ),
  })

  const dest = destination.trim() || address || ''
  const rows = holdings.data ?? []
  const withFunds = rows.filter((r) => r.sol > 0n || r.tokens.length > 0)
  const spent = rows.length - withFunds.length

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Private payments to you</h2>
        <button className="link text-xs" onClick={() => void qc.invalidateQueries({ queryKey: ['stealth'] })} disabled={feed.isFetching}>
          {feed.isFetching ? 'Scanning…' : 'Scan again'}
        </button>
      </div>
      {feed.error && (
        <p className="text-sm text-serial">Could not download the payment feed. Is the wallet server running? {friendlyError(feed.error)}</p>
      )}
      {feed.data && (
        <p className="text-xs text-muted">
          Checked {feed.data.scanned} public announcement{feed.data.scanned === 1 ? '' : 's'} against your keys, here in
          your browser. The server never learns which are yours.
        </p>
      )}

      {withFunds.length > 0 && (
        <div>
          <label className="label">Withdraw to</label>
          <input
            className="input font-serial text-xs"
            placeholder={address ?? ''}
            autoComplete="off"
            spellCheck={false}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />
          <p className="mt-1.5 text-xs text-muted">
            Defaults to this account. For the most privacy use a different, fresh address: sending it straight into your
            main wallet lets someone who knows that wallet connect the two.
          </p>
        </div>
      )}

      <ul className="divide-y divide-line border-y border-line empty:hidden">
        {withFunds.map((h) => (
          <PaymentRow key={h.payment.address} holdings={h} destination={dest} />
        ))}
      </ul>
      {feed.data && feed.data.payments.length === 0 && (
        <p className="text-sm text-muted">No private payments yet. Share your stealth address to receive one.</p>
      )}
      {feed.data && feed.data.payments.length > 0 && holdings.isLoading && <p className="text-sm text-muted">Found {feed.data.payments.length} payment{feed.data.payments.length === 1 ? '' : 's'}. Checking what is waiting in them…</p>}
      {holdings.error && !holdings.data && (
        <p className="text-sm text-serial">
          Could not read the balances of your one-time addresses. The network may be busy: <button className="link" onClick={() => void holdings.refetch()}>try again</button>.
        </p>
      )}
      {rows.length > 0 && withFunds.length === 0 && <p className="text-sm text-muted">Nothing waiting: everything sent to you has been withdrawn.</p>}
      {spent > 0 && withFunds.length > 0 && <p className="text-xs text-muted">{spent} earlier payment{spent === 1 ? '' : 's'} already withdrawn.</p>}
    </section>
  )
}

function PaymentRow({ holdings, destination }: { holdings: Holdings; destination: string }) {
  const { address } = useWallet()
  const toast = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { payment, sol, tokens } = holdings

  const withdraw = async () => {
    setError('')
    if (!validAddress(destination)) return setError('Enter a valid address to withdraw to.')
    if (destination === payment.address) return setError('That is the payment address itself.')
    setBusy(true)
    try {
      const { signature: sig } = await sweepStealthAddress({ payment, destination })
      toast.success(`Withdrawn to ${shortAddr(destination, 5)}.`, { label: 'View on Solana Explorer', href: explorerTx(sig) })
      void qc.invalidateQueries({ queryKey: ['stealth'] })
      void qc.invalidateQueries({ queryKey: ['assets', address] })
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const parts = [
    ...(sol > 0n ? [`${formatUnits(sol, 9, 6)} SOL`] : []),
    ...tokens.map((t) => `${formatUnits(t.amount, t.decimals, 6)} ${tokenByMint(t.mint)?.symbol ?? shortAddr(t.mint, 3)}`),
  ]

  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="num text-sm font-semibold">{parts.join(' + ')}</div>
          <a className="text-xs text-muted underline decoration-dotted" href={explorerAddress(payment.address)} target="_blank" rel="noreferrer">
            one-time address {shortAddr(payment.address, 5)}
            {payment.blockTime ? ` · ${new Date(payment.blockTime * 1000).toLocaleString()}` : ''}
          </a>
        </div>
        <button className="btn-primary px-3! py-1.5! min-h-9! text-xs" disabled={busy} onClick={withdraw}>
          {busy ? 'Withdrawing…' : 'Withdraw'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-serial">{error}</p>}
    </li>
  )
}
