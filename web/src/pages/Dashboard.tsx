import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { claimFaucet, getPrices } from '../api'
import CopyButton from '../components/CopyButton'
import { explorerAddress, LAMPORTS_PER_SOL } from '../config'
import { formatUnits, shortAddr } from '../lib/format'
import { requestAirdrop } from '../wallet/rpc'
import { useAssets } from '../wallet/useAssets'
import { useWallet } from '../wallet/WalletContext'

export default function Dashboard() {
  const { address } = useWallet()
  const { data: assets, isLoading, error } = useAssets()
  const qc = useQueryClient()
  const prices = useQuery({ queryKey: ['prices'], queryFn: getPrices, refetchInterval: 60_000, staleTime: 30_000, retry: false })
  const [faucet, setFaucet] = useState<{ state: 'idle' | 'busy' | 'ok' | 'err'; msg?: string }>({ state: 'idle' })
  const [airdrop, setAirdrop] = useState<{ state: 'idle' | 'busy' | 'ok' | 'err'; msg?: string }>({ state: 'idle' })

  const getSol = async () => {
    if (!address) return
    setAirdrop({ state: 'busy' })
    try {
      await requestAirdrop(address, LAMPORTS_PER_SOL)
      setAirdrop({ state: 'ok', msg: '1 devnet SOL requested. It should arrive in a few seconds.' })
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['assets', address] }), 4000)
    } catch {
      setAirdrop({
        state: 'err',
        msg: 'The public devnet faucet is rate-limited. Try again later, or use faucet.solana.com with your address.',
      })
    }
  }

  const getTestTokens = async () => {
    if (!address) return
    setFaucet({ state: 'busy' })
    try {
      const res = await claimFaucet(address)
      const text = res.tokens.map((t) => `${formatUnits(BigInt(t.amount), t.decimals)} ${t.symbol}`).join(' and ')
      setFaucet({ state: 'ok', msg: `Sent ${text}.` })
      void qc.invalidateQueries({ queryKey: ['assets', address] })
    } catch (e) {
      setFaucet({ state: 'err', msg: e instanceof Error ? e.message : 'The faucet is unavailable.' })
    }
  }

  const sol = assets?.find((a) => a.id === 'sol')
  const solUsd = sol && prices.data?.solUsd ? (Number(sol.balance) / 1e9) * prices.data.solUsd : null

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="text-xs uppercase tracking-wide text-muted">Balance</div>
        <div className="mt-1 text-4xl font-bold tracking-tight">
          {sol ? formatUnits(sol.balance, 9, 6) : '—'} <span className="text-lg font-semibold text-muted">SOL</span>
        </div>
        {solUsd !== null && (
          <div className="mt-1 text-sm text-muted">
            ≈ ${solUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            {prices.data?.stale && ' (price may be out of date)'}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
          <a className="underline decoration-dotted" href={address ? explorerAddress(address) : '#'} target="_blank" rel="noreferrer">
            {address ? shortAddr(address, 6) : ''}
          </a>
          {address && <CopyButton text={address} label="Copy address" />}
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2">
          <Link to="/send" className="btn-primary">
            Send
          </Link>
          <Link to="/receive" className="btn-ghost">
            Receive
          </Link>
          <button className="btn-ghost" onClick={getSol} disabled={airdrop.state === 'busy'}>
            {airdrop.state === 'busy' ? 'Requesting…' : 'Get SOL'}
          </button>
        </div>
        <button className="btn-ghost mt-2 w-full" onClick={getTestTokens} disabled={faucet.state === 'busy'}>
          {faucet.state === 'busy' ? 'Minting…' : 'Get test tokens (tUSDC + tBONK)'}
        </button>
        {faucet.msg && <p className={`mt-3 text-xs ${faucet.state === 'err' ? 'text-amber-300' : 'text-accent2'}`}>{faucet.msg}</p>}
        {airdrop.msg && (
          <p className={`mt-3 text-xs ${airdrop.state === 'err' ? 'text-amber-300' : 'text-accent2'}`}>{airdrop.msg}</p>
        )}
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold">Assets</h2>
        {isLoading && <p className="text-sm text-muted">Loading…</p>}
        {error && <p className="text-sm text-red-400">Could not load balances from the network. Retrying…</p>}
        <ul className="divide-y divide-line">
          {assets?.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-xs font-bold">
                  {a.symbol.slice(0, 3)}
                </div>
                <div>
                  <div className="text-sm font-medium">{a.symbol}</div>
                  <div className="text-xs text-muted">{a.name}</div>
                </div>
              </div>
              <div className="text-right text-sm font-medium">{formatUnits(a.balance, a.decimals, 6)}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
