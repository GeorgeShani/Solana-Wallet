import { useQueryClient } from '@tanstack/react-query'
import { WSOL_MINT, type SwapToken } from '@wallet/shared'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { explorerTx } from '../config'
import { friendlyError } from '../lib/errors'
import { formatUnits, parseUnits } from '../lib/format'
import { buildSwapInstructions } from '../swap/buildSwap'
import { findRoute, quoteSwap, SWAP_TOKENS, usePools } from '../swap/pools'
import { confirmSignature } from '../wallet/rpc'
import { useAssets } from '../wallet/useAssets'
import { useWallet } from '../wallet/WalletContext'

const SLIPPAGE_PRESETS = [10, 50, 100] // basis points
/** Keep SOL back for the network fee and for opening token accounts. */
const SOL_RESERVE = 5_000_000n // 0.005 SOL
const WARN_IMPACT_BPS = 500 // 5%: ask for an explicit OK
const BLOCK_IMPACT_BPS = 1500 // 15%: refuse

const assetId = (t: SwapToken) => (t.mint === WSOL_MINT ? 'sol' : t.mint)
const bps = (n: number) => `${(n / 100).toFixed(2)}%`

interface Done {
  sig: string
  tokenIn: SwapToken
  tokenOut: SwapToken
  amountIn: bigint
  expectedOut: bigint
}

export default function Swap() {
  const { service, accountIndex, address } = useWallet()
  const { data: assets } = useAssets()
  const { data: pools, isLoading: poolsLoading, error: poolsError } = usePools()
  const qc = useQueryClient()

  const [fromMint, setFromMint] = useState(SWAP_TOKENS[0]?.mint ?? '')
  const [toMint, setToMint] = useState(SWAP_TOKENS[1]?.mint ?? '')
  const [amountText, setAmountText] = useState('')
  const [slippageBps, setSlippageBps] = useState(100)
  const [customSlippage, setCustomSlippage] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<Done | null>(null)

  const from = SWAP_TOKENS.find((t) => t.mint === fromMint)
  const to = SWAP_TOKENS.find((t) => t.mint === toMint)
  const balanceOf = (t?: SwapToken) => assets?.find((a) => a.id === (t ? assetId(t) : ''))?.balance ?? 0n
  const solBalance = balanceOf(SWAP_TOKENS.find((t) => t.mint === WSOL_MINT))

  const amountIn = from ? parseUnits(amountText, from.decimals) : null
  const route = useMemo(() => (pools && from && to ? findRoute(pools, from.mint, to.mint) : null), [pools, from, to])
  const quote = useMemo(
    () => (route && amountIn ? quoteSwap(route, amountIn, slippageBps) : null),
    [route, amountIn, slippageBps],
  )

  const pickFrom = (mint: string) => {
    if (mint === toMint) setToMint(fromMint)
    setFromMint(mint)
    setAcknowledged(false)
  }
  const pickTo = (mint: string) => {
    if (mint === fromMint) setFromMint(toMint)
    setToMint(mint)
    setAcknowledged(false)
  }
  const flip = () => {
    setFromMint(toMint)
    setToMint(fromMint)
    setAmountText('')
    setAcknowledged(false)
  }
  const setMax = () => {
    if (!from) return
    const bal = balanceOf(from)
    const max = from.mint === WSOL_MINT ? (bal > SOL_RESERVE ? bal - SOL_RESERVE : 0n) : bal
    setAmountText(formatUnits(max, from.decimals))
    setAcknowledged(false)
  }
  const setCustom = (v: string) => {
    setCustomSlippage(v)
    const n = Number(v)
    if (v !== '' && Number.isFinite(n) && n >= 0.01 && n <= 50) setSlippageBps(Math.round(n * 100))
  }

  // What (if anything) stops the button from working, in the order a person would fix it.
  let blocker = ''
  if (poolsError) blocker = 'Could not load pools'
  else if (poolsLoading) blocker = 'Loading pools…'
  else if (!from || !to) blocker = 'Choose tokens'
  else if (!route) blocker = 'No pool for this pair'
  else if (!amountText) blocker = 'Enter an amount'
  else if (amountIn === null || amountIn <= 0n) blocker = 'Enter a valid amount'
  else if (amountIn > balanceOf(from)) blocker = `Insufficient ${from.symbol}`
  else if (from.mint === WSOL_MINT && amountIn + SOL_RESERVE > solBalance) blocker = 'Keep ~0.005 SOL for fees'
  else if (from.mint !== WSOL_MINT && solBalance < SOL_RESERVE) blocker = 'You need ~0.005 SOL for fees'
  else if (!quote) blocker = 'Amount too small for this pool'
  else if (quote.impactBps >= BLOCK_IMPACT_BPS) blocker = 'Price impact too high'
  else if (quote.impactBps >= WARN_IMPACT_BPS && !acknowledged) blocker = 'Confirm the price impact below'

  const swap = async () => {
    if (!service || !address || !from || !to || !quote || !amountIn) return
    setBusy(true)
    setError('')
    try {
      const ixs = await buildSwapInstructions({
        user: address,
        tokenIn: from,
        tokenOut: to,
        amountIn,
        minAmountOut: quote.minOut,
      })
      const { hash } = await service.sendInstructions(accountIndex, ixs)
      await confirmSignature(hash)
      setDone({ sig: hash, tokenIn: from, tokenOut: to, amountIn, expectedOut: quote.amountOut })
      void qc.invalidateQueries({ queryKey: ['assets', address] })
      void qc.invalidateQueries({ queryKey: ['history', address] })
      void qc.invalidateQueries({ queryKey: ['pools'] })
    } catch (e) {
      setError(friendlyError(e))
      void qc.invalidateQueries({ queryKey: ['pools'] }) // a failed swap usually means the price moved
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="card space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent2/15 text-2xl text-accent2">✓</div>
        <h2 className="text-lg font-semibold">Swap complete</h2>
        <p className="text-sm text-muted">
          {formatUnits(done.amountIn, done.tokenIn.decimals)} {done.tokenIn.symbol} for about{' '}
          {formatUnits(done.expectedOut, done.tokenOut.decimals, 6)} {done.tokenOut.symbol}
        </p>
        <a className="block text-sm text-accent underline" href={explorerTx(done.sig)} target="_blank" rel="noreferrer">
          View on Solana Explorer
        </a>
        <div className="flex gap-2">
          <button
            className="btn-ghost flex-1"
            onClick={() => {
              setDone(null)
              setAmountText('')
              setAcknowledged(false)
            }}
          >
            Swap again
          </button>
          <Link to="/" className="btn-primary flex-1">
            Done
          </Link>
        </div>
      </div>
    )
  }

  const rate =
    quote && from && to
      ? Number(quote.amountOut) / 10 ** to.decimals / (Number(quote.amountIn) / 10 ** from.decimals)
      : null
  const highImpact = quote && quote.impactBps >= WARN_IMPACT_BPS

  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">Swap</h2>

      <TokenBox
        label="You pay"
        token={from}
        onPick={pickFrom}
        balance={balanceOf(from)}
        input={
          <input
            className="w-full bg-transparent text-2xl font-semibold outline-none placeholder:text-muted/50"
            inputMode="decimal"
            placeholder="0.0"
            value={amountText}
            onChange={(e) => {
              setAmountText(e.target.value)
              setAcknowledged(false)
            }}
          />
        }
        onMax={setMax}
      />

      <div className="relative flex justify-center">
        <button
          type="button"
          aria-label="Flip tokens"
          onClick={flip}
          className="z-10 -my-5 flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-panel text-lg transition hover:bg-white/10"
        >
          ⇅
        </button>
      </div>

      <TokenBox
        label="You receive (estimated)"
        token={to}
        onPick={pickTo}
        balance={balanceOf(to)}
        input={
          <div className="text-2xl font-semibold">
            {quote && to ? formatUnits(quote.amountOut, to.decimals, 6) : <span className="text-muted/50">0.0</span>}
          </div>
        }
      />

      {quote && from && to && (
        <dl className="space-y-1.5 rounded-xl border border-line bg-ink p-3 text-xs">
          <Row k="Rate" v={rate ? `1 ${from.symbol} ≈ ${formatRate(rate)} ${to.symbol}` : '—'} />
          <Row
            k="Price impact"
            v={<span className={highImpact ? 'font-semibold text-amber-300' : ''}>{bps(quote.impactBps)}</span>}
          />
          <Row k="Pool fee" v={bps(route!.pool.feeBps)} />
          <Row k={`Minimum received (${bps(slippageBps)} slippage)`} v={`${formatUnits(quote.minOut, to.decimals, 6)} ${to.symbol}`} />
        </dl>
      )}

      <div>
        <div className="label">Slippage tolerance</div>
        <div className="flex items-center gap-2">
          {SLIPPAGE_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                slippageBps === p && customSlippage === '' ? 'border-accent bg-accent/15' : 'border-line hover:bg-white/5'
              }`}
              onClick={() => {
                setSlippageBps(p)
                setCustomSlippage('')
              }}
            >
              {bps(p)}
            </button>
          ))}
          <div className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs">
            <input
              aria-label="Custom slippage percent"
              className="w-12 bg-transparent text-right outline-none"
              inputMode="decimal"
              placeholder="custom"
              value={customSlippage}
              onChange={(e) => setCustom(e.target.value)}
            />
            %
          </div>
        </div>
        <p className="mt-1.5 text-xs text-muted">
          If the price moves further than this before your trade lands, it is cancelled and nothing is swapped.
        </p>
      </div>

      {highImpact && quote && quote.impactBps < BLOCK_IMPACT_BPS && (
        <label className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-200">
          <input type="checkbox" className="mt-0.5" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
          This trade is large for the pool and moves the price by {bps(quote.impactBps)}, so you get a noticeably worse
          rate. I understand.
        </label>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <button className="btn-primary w-full" disabled={busy || blocker !== ''} onClick={swap}>
        {busy ? 'Swapping…' : blocker || 'Swap'}
      </button>
      <p className="text-center text-xs text-muted">
        Trades against on-chain test pools on devnet. Test tokens have no value.
      </p>
    </div>
  )
}

function formatRate(r: number): string {
  if (r >= 1000) return r.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (r >= 1) return r.toLocaleString(undefined, { maximumFractionDigits: 4 })
  return r.toPrecision(4)
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  )
}

function TokenBox(props: {
  label: string
  token?: SwapToken
  onPick: (mint: string) => void
  balance: bigint
  input: React.ReactNode
  onMax?: () => void
}) {
  const { label, token, onPick, balance, input, onMax } = props
  return (
    <div className="rounded-xl border border-line bg-ink p-3">
      <div className="mb-1 flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
        <span>
          Balance: {token ? formatUnits(balance, token.decimals, 6) : '0'}
          {onMax && (
            <button type="button" className="ml-2 text-accent" onClick={onMax}>
              Max
            </button>
          )}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">{input}</div>
        <select
          aria-label={`${label} token`}
          className="rounded-lg border border-line bg-panel px-2 py-1.5 text-sm font-semibold"
          value={token?.mint ?? ''}
          onChange={(e) => onPick(e.target.value)}
        >
          {SWAP_TOKENS.map((t) => (
            <option key={t.mint} value={t.mint}>
              {t.symbol}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
