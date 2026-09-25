import { useQuery, useQueryClient } from '@tanstack/react-query'
import { WSOL_MINT } from '@wallet/shared'
import { ArrowDownToLine, ArrowLeftRight, Coins, ExternalLink, Send } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { claimFaucet, getPrices } from '../api'
import CopyButton from '../components/CopyButton'
import { explorerAddress, LAMPORTS_PER_SOL } from '../config'
import { formatUnits } from '../lib/format'
import { Band, Medallion } from '../ui/Guilloche'
import { useToast } from '../ui/toastContext'
import { requestAirdrop } from '../wallet/rpc'
import { useAssets } from '../wallet/useAssets'
import { useWallet } from '../wallet/WalletContext'

/** The address in the groups a banknote serial number is printed in. */
const serialGroups = (a: string) => `${a.slice(0, 4)} ${a.slice(4, 8)} · ${a.slice(-4)}`

export default function Dashboard() {
  const { address } = useWallet()
  const { data: assets, isLoading, error } = useAssets()
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const prices = useQuery({ queryKey: ['prices'], queryFn: getPrices, refetchInterval: 60_000, staleTime: 30_000, retry: false })
  const [busy, setBusy] = useState<'sol' | 'tokens' | null>(null)
  const [fundingOpen, setFundingOpen] = useState<boolean | null>(null)

  const sol = assets?.find((a) => a.id === 'sol')
  const empty = !!assets && (sol?.balance ?? 0n) === 0n && assets.every((a) => a.balance === 0n)
  const showFunding = fundingOpen ?? empty
  const solUsd = sol && prices.data?.solUsd ? (Number(sol.balance) / 1e9) * prices.data.solUsd : null

  const getSol = async () => {
    if (!address) return
    setBusy('sol')
    try {
      await requestAirdrop(address, LAMPORTS_PER_SOL)
      toast.success('1 devnet SOL is on its way. It should arrive in a few seconds.')
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['assets', address] }), 4000)
    } catch {
      toast.error('The public devnet faucet is busy. Try again later, or use faucet.solana.com with your address.')
    } finally {
      setBusy(null)
    }
  }

  const getTestTokens = async () => {
    if (!address) return
    setBusy('tokens')
    try {
      const res = await claimFaucet(address)
      toast.success(`Received ${res.tokens.map((t) => `${formatUnits(BigInt(t.amount), t.decimals)} ${t.symbol}`).join(' and ')}.`)
      void qc.invalidateQueries({ queryKey: ['assets', address] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The faucet is unavailable.')
    } finally {
      setBusy(null)
    }
  }

  const [whole, fraction = ''] = (sol ? formatUnits(sol.balance, 9, 6) : '—').split('.')

  return (
    <div className="space-y-6">
      <section className="banknote rise" aria-label="Balance">
        <Band seed={address ?? 'wallet'} className="absolute inset-x-0 top-0 h-[68px] w-full text-plate/55" draw />
        <div className="relative px-5 pt-[76px] pb-4">
          <div className="flex items-baseline gap-2">
            <span className="numeral text-[54px] leading-none" aria-label={`${sol ? formatUnits(sol.balance, 9, 6) : 'unknown'} SOL`}>
              {whole}
              {fraction && <span className="text-[32px] opacity-70">.{fraction}</span>}
            </span>
            <span className="font-serial text-xs font-semibold text-muted">SOL</span>
          </div>
          <p className="mt-1.5 h-5 text-sm text-muted">
            {solUsd !== null ? (
              <>
                ≈ ${solUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                {prices.data?.stale && ' (price may be out of date)'}
              </>
            ) : (
              ''
            )}
          </p>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-dashed border-line pt-3">
            <span className="serial min-w-0 truncate" title={address ?? ''}>
              Nº {address ? serialGroups(address) : '—'}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {address && <CopyButton text={address} label="Copy" />}
              {address && (
                <a
                  className="grid size-8 place-items-center rounded-[6px] text-plate hover:bg-plate/8"
                  href={explorerAddress(address)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="View address on Solana Explorer"
                  title="View on Solana Explorer"
                >
                  <ExternalLink className="size-4" />
                </a>
              )}
            </span>
          </div>
          <p className="microtext mt-3" aria-hidden>
            Devnet test money · no real value · Devnet test money · no real value · Devnet test money
          </p>
        </div>
      </section>

      <nav className="grid grid-cols-4 gap-2" aria-label="Actions">
        <Link to="/send" className="stamp">
          <span className="stamp-disc">
            <Send className="size-5" />
          </span>
          Send
        </Link>
        <Link to="/receive" className="stamp">
          <span className="stamp-disc">
            <ArrowDownToLine className="size-5" />
          </span>
          Receive
        </Link>
        <button className="stamp" onClick={() => navigate('/swap')}>
          <span className="stamp-disc">
            <ArrowLeftRight className="size-5" />
          </span>
          Swap
        </button>
        <button className="stamp" onClick={() => setFundingOpen(!showFunding)} aria-expanded={showFunding}>
          <span className="stamp-disc">
            <Coins className="size-5" />
          </span>
          Get funds
        </button>
      </nav>

      {showFunding && (
        <section className="card rise space-y-3">
          <div>
            <h2 className="font-semibold">Get free test money</h2>
            <p className="mt-1 text-sm text-muted">
              This wallet runs on Solana's practice network. Its coins are free and worth nothing, so you can try everything safely.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button className="btn-primary" onClick={getSol} disabled={busy !== null}>
              {busy === 'sol' ? 'Requesting…' : 'Get 1 test SOL'}
            </button>
            <button className="btn-ghost" onClick={getTestTokens} disabled={busy !== null}>
              {busy === 'tokens' ? 'Minting…' : 'Get test tokens'}
            </button>
          </div>
          {busy && <div className="inking" role="status" aria-label="Working" />}
        </section>
      )}

      <section aria-labelledby="assets-h">
        <h2 id="assets-h" className="mb-1 text-[15px] font-semibold">
          Assets
        </h2>
        {isLoading && <p className="py-3 text-sm text-muted">Loading your balances…</p>}
        {error && <p className="py-3 text-sm text-serial">Could not load balances from the network. Retrying…</p>}
        <ul className="divide-y divide-line border-y border-line">
          {assets?.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <Medallion seed={a.id === 'sol' ? WSOL_MINT : a.id} label={a.symbol} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{a.symbol}</div>
                  <div className="truncate text-xs text-muted">{a.name}</div>
                </div>
              </div>
              <div className="num text-right text-sm font-semibold">{formatUnits(a.balance, a.decimals, 6)}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
