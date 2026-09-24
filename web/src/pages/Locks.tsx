import { useQuery, useQueryClient } from '@tanstack/react-query'
import { vestedAmount, withdrawableAmount, WSOL_MINT } from '@wallet/shared'
import { useState } from 'react'
import { explorerTx } from '../config'
import { friendlyError } from '../lib/errors'
import { formatUnits, parseUnits, shortAddr } from '../lib/format'
import { relativeTime, useNow } from '../lib/useNow'
import {
  buildCancelLockInstructions,
  buildCreateLockInstructions,
  buildWithdrawInstructions,
  fetchTimelocks,
  randomSeed,
  type TimelockInfo,
} from '../locks/chain'
import { buildSchedule, CLIFFS, DURATIONS, fromDateTimeLocal, toDateTimeLocal, validateSchedule } from '../locks/schedule'
import { useTokenMeta } from '../links/useTokenMeta'
import { confirmSignature, validAddress } from '../wallet/rpc'
import { useAssets } from '../wallet/useAssets'
import { useWallet } from '../wallet/WalletContext'

/** SOL to keep back: the lock's accounts need refundable rent deposits, plus fees. */
const SOL_RESERVE = 6_000_000n

export default function Locks() {
  const { address } = useWallet()
  const incoming = useQuery({
    queryKey: ['locks', 'recipient', address],
    enabled: !!address,
    refetchInterval: 20_000,
    queryFn: () => fetchTimelocks('recipient', address!),
  })
  const outgoing = useQuery({
    queryKey: ['locks', 'sender', address],
    enabled: !!address,
    refetchInterval: 20_000,
    queryFn: () => fetchTimelocks('sender', address!),
  })

  return (
    <div className="space-y-4">
      <CreateLock />
      <LockList
        title="Incoming: locked for you"
        empty="Nothing is locked for you right now."
        locks={incoming.data}
        loading={incoming.isLoading}
        role="recipient"
      />
      <LockList
        title="Outgoing: locked by you"
        empty="You haven't locked anything. Finished locks disappear from this list."
        locks={outgoing.data}
        loading={outgoing.isLoading}
        role="sender"
      />
    </div>
  )
}

function CreateLock() {
  const { service, accountIndex, address } = useWallet()
  const { data: assets } = useAssets()
  const qc = useQueryClient()

  const [assetId, setAssetId] = useState('sol')
  const [recipient, setRecipient] = useState('')
  const [amountText, setAmountText] = useState('')
  const [mode, setMode] = useState<'date' | 'vest'>('vest')
  const [unlockText, setUnlockText] = useState('')
  const [duration, setDuration] = useState(DURATIONS[1].seconds)
  const [cliffFraction, setCliffFraction] = useState(0)
  const [cancellable, setCancellable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ sig: string; text: string } | null>(null)

  const asset = assets?.find((a) => a.id === assetId)
  const sol = assets?.find((a) => a.id === 'sol')

  const setMax = () => {
    if (!asset) return
    const max = asset.id === 'sol' ? (asset.balance > SOL_RESERVE ? asset.balance - SOL_RESERVE : 0n) : asset.balance
    setAmountText(formatUnits(max, asset.decimals))
  }

  const quickUnlock = (seconds: number) => setUnlockText(toDateTimeLocal(Math.floor(Date.now() / 1000) + seconds))

  const create = async () => {
    setError('')
    if (!service || !address || !asset || !sol) return
    const to = recipient.trim()
    if (!validAddress(to)) return setError('Enter a valid Solana address for the recipient.')
    const amount = parseUnits(amountText, asset.decimals)
    if (amount === null || amount <= 0n) return setError('Enter a valid amount.')
    if (amount > asset.balance) return setError(`Not enough ${asset.symbol}.`)
    if (asset.id === 'sol' ? amount + SOL_RESERVE > asset.balance : sol.balance < SOL_RESERVE) {
      return setError('Keep about 0.006 SOL for fees and the refundable deposits that hold the lock.')
    }

    const now = Math.floor(Date.now() / 1000)
    let schedule
    if (mode === 'date') {
      const unlockAt = fromDateTimeLocal(unlockText)
      if (unlockAt === null) return setError('Pick the date and time when it unlocks.')
      schedule = buildSchedule({ mode, unlockAt })
    } else {
      schedule = buildSchedule({ mode, now, duration, cliffFraction })
    }
    const problem = validateSchedule(schedule, now)
    if (problem) return setError(problem)

    setBusy(true)
    try {
      const ixs = await buildCreateLockInstructions({
        sender: address,
        recipient: to,
        mint: asset.id === 'sol' ? null : asset.id,
        amount,
        schedule,
        cancellable,
        seed: randomSeed(),
      })
      const { hash } = await service.sendInstructions(accountIndex, ixs)
      await confirmSignature(hash)
      setDone({ sig: hash, text: `${formatUnits(amount, asset.decimals)} ${asset.symbol} locked for ${shortAddr(to, 6)}` })
      setAmountText('')
      void qc.invalidateQueries({ queryKey: ['assets', address] })
      void qc.invalidateQueries({ queryKey: ['locks'] })
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="card space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent2/15 text-2xl text-accent2">✓</div>
        <h2 className="text-lg font-semibold">Locked</h2>
        <p className="text-sm text-muted">{done.text}</p>
        <p className="text-xs text-muted">The recipient sees it under "Incoming" in their wallet and withdraws it as it unlocks.</p>
        <a className="block text-sm text-accent underline" href={explorerTx(done.sig)} target="_blank" rel="noreferrer">
          View on Solana Explorer
        </a>
        <button className="btn-ghost w-full" onClick={() => setDone(null)}>
          Lock something else
        </button>
      </div>
    )
  }

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="font-semibold">Lock funds</h2>
        <p className="mt-1 text-xs text-muted">
          Set aside SOL or tokens for someone (or for your future self). The program holds them and releases them on
          a schedule you choose, and no one can touch them early.
        </p>
      </div>
      <div>
        <label className="label">Recipient address</label>
        <input
          className="input font-mono"
          placeholder="Solana address"
          autoComplete="off"
          spellCheck={false}
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
        />
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
          <div className="flex items-end justify-between">
            <label className="label">Amount</label>
            <button type="button" className="mb-1.5 text-xs text-accent" onClick={setMax}>
              Max
            </button>
          </div>
          <input className="input" inputMode="decimal" placeholder="0.0" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
        </div>
      </div>

      <div>
        <div className="label">Release</div>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {(
            [
              ['vest', 'Gradually'],
              ['date', 'On a date'],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                mode === m ? 'border-accent bg-accent/15' : 'border-line hover:bg-white/5'
              }`}
              onClick={() => setMode(m)}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'vest' ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Over</label>
              <select className="input" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {DURATIONS.map((d) => (
                  <option key={d.seconds} value={d.seconds}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Cliff</label>
              <select className="input" value={cliffFraction} onChange={(e) => setCliffFraction(Number(e.target.value))}>
                {CLIFFS.map((c) => (
                  <option key={c.fraction} value={c.fraction}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="col-span-2 text-xs text-muted">
              It unlocks in a steady stream, second by second. With a cliff, nothing unlocks until that point, then
              everything that has accrued so far unlocks at once.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              className="input"
              type="datetime-local"
              aria-label="Unlock date and time"
              value={unlockText}
              onChange={(e) => setUnlockText(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {[
                ['In 5 minutes', 300],
                ['In 1 hour', 3_600],
                ['Tomorrow', 86_400],
              ].map(([label, secs]) => (
                <button
                  key={label}
                  type="button"
                  className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:bg-white/5"
                  onClick={() => quickUnlock(Number(secs))}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">Nothing can be withdrawn until then; at that moment all of it unlocks.</p>
          </div>
        )}
      </div>

      <label className="flex items-start gap-2 rounded-lg bg-white/5 p-3 text-xs text-muted">
        <input type="checkbox" className="mt-0.5" checked={cancellable} onChange={(e) => setCancellable(e.target.checked)} />
        <span>
          <b className="text-white">Let me cancel it.</b> If you cancel, the part that hasn't unlocked yet comes back to
          you and the recipient keeps what they've already earned. Leave this off for a lock nobody can undo.
        </span>
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <button className="btn-primary w-full" disabled={busy || !amountText || !recipient || !asset} onClick={create}>
        {busy ? 'Locking…' : 'Lock funds'}
      </button>
      <p className="text-center text-xs text-muted">A small refundable deposit (about 0.003 SOL) holds the lock and returns to you when it finishes.</p>
    </div>
  )
}

function LockList(props: {
  title: string
  empty: string
  locks?: TimelockInfo[]
  loading: boolean
  role: 'sender' | 'recipient'
}) {
  return (
    <div className="card">
      <h2 className="mb-3 text-sm font-semibold">{props.title}</h2>
      {props.loading && <p className="text-sm text-muted">Loading…</p>}
      {props.locks?.length === 0 && <p className="text-sm text-muted">{props.empty}</p>}
      <ul className="divide-y divide-line">
        {props.locks?.map((l) => <LockRow key={l.account} lock={l} role={props.role} />)}
      </ul>
    </div>
  )
}

function LockRow({ lock, role }: { lock: TimelockInfo; role: 'sender' | 'recipient' }) {
  const { service, accountIndex, address } = useWallet()
  const qc = useQueryClient()
  const now = useNow()
  const { data: meta } = useTokenMeta(lock.mint === WSOL_MINT ? null : lock.mint)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')

  const nowBig = BigInt(now)
  const vested = vestedAmount(lock.total, lock.start, lock.cliff, lock.end, nowBig)
  const available = withdrawableAmount(lock, nowBig)
  const pct = lock.total > 0n ? Number((vested * 1000n) / lock.total) / 10 : 0
  const finished = vested >= lock.total
  const fmt = (v: bigint) => (meta ? `${formatUnits(v, meta.decimals, 6)} ${meta.symbol}` : '…')

  const run = async (build: () => Promise<Parameters<NonNullable<typeof service>['sendInstructions']>[1]>) => {
    if (!service) return
    setBusy(true)
    setError('')
    try {
      const { hash } = await service.sendInstructions(accountIndex, await build())
      await confirmSignature(hash)
      void qc.invalidateQueries({ queryKey: ['locks'] })
      void qc.invalidateQueries({ queryKey: ['assets', address] })
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  const status = finished
    ? 'Fully unlocked'
    : now < Number(lock.cliff)
      ? `Nothing unlocks until ${relativeTime(Number(lock.cliff), now)}`
      : `Fully unlocked ${relativeTime(Number(lock.end), now)}`

  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{fmt(lock.total)}</div>
          <div className="text-xs text-muted">
            {role === 'recipient' ? `from ${shortAddr(lock.sender, 4)}` : `to ${shortAddr(lock.recipient, 4)}`} · {status}
          </div>
        </div>
        {role === 'recipient' ? (
          <button className="btn-primary !px-3 !py-1.5 text-xs" disabled={busy || available === 0n} onClick={() => run(() => buildWithdrawInstructions(lock))}>
            {busy ? 'Withdrawing…' : available > 0n ? `Withdraw ${fmt(available)}` : 'Nothing yet'}
          </button>
        ) : lock.cancellable && !finished ? (
          !confirming ? (
            <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setConfirming(true)}>
              Cancel
            </button>
          ) : (
            <div className="flex gap-2">
              <button className="btn-ghost !px-3 !py-1.5 text-xs" disabled={busy} onClick={() => setConfirming(false)}>
                Keep
              </button>
              <button className="btn-danger !px-3 !py-1.5 text-xs" disabled={busy} onClick={() => run(() => buildCancelLockInstructions(lock))}>
                {busy ? 'Cancelling…' : 'Yes, cancel'}
              </button>
            </div>
          )
        ) : (
          <span className="text-xs text-muted">{lock.cancellable ? '' : 'Can’t be cancelled'}</span>
        )}
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent2 transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted">
        <span>{pct.toFixed(1)}% unlocked</span>
        <span>{lock.withdrawn > 0n ? `${fmt(lock.withdrawn)} withdrawn` : ''}</span>
      </div>
      {confirming && !busy && role === 'sender' && (
        <p className="mt-2 text-xs text-muted">
          You get back what hasn't unlocked yet. {fmt(vested - lock.withdrawn)} that the recipient has already earned stays theirs.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </li>
  )
}
