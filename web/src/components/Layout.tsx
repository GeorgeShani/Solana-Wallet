import { ArrowLeftRight, ChevronDown, ChevronLeft, GalleryVertical, History, LayoutGrid, Lock, Wallet } from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { CLUSTER } from '../config'
import { shortAddr } from '../lib/format'
import { Rosette } from '../ui/Guilloche'
import { LogoMark } from '../ui/Logo'
import { useWallet } from '../wallet/WalletContext'

interface Tab {
  to: string
  label: string
  icon: typeof Wallet
  /** Paths (prefixes) that light this tab up. */
  owns: string[]
}

const TABS: Tab[] = [
  { to: '/', label: 'Wallet', icon: Wallet, owns: ['/', '/send', '/receive'] },
  { to: '/swap', label: 'Swap', icon: ArrowLeftRight, owns: ['/swap'] },
  { to: '/nfts', label: 'NFTs', icon: GalleryVertical, owns: ['/nfts'] },
  { to: '/activity', label: 'Activity', icon: History, owns: ['/activity'] },
  { to: '/more', label: 'More', icon: LayoutGrid, owns: ['/more', '/links', '/locks', '/stealth', '/settings'] },
]

/** Screens that sit one level down get a title and a way back. Tab screens have neither. */
const SUBSCREENS: { prefix: string; title: string; back: string }[] = [
  { prefix: '/send', title: 'Send', back: '/' },
  { prefix: '/receive', title: 'Receive', back: '/' },
  { prefix: '/links', title: 'Pay by link', back: '/more' },
  { prefix: '/locks', title: 'Lock funds', back: '/more' },
  { prefix: '/stealth', title: 'Private payments', back: '/more' },
  { prefix: '/settings', title: 'Settings', back: '/more' },
  { prefix: '/nfts/mint', title: 'Mint an NFT', back: '/nfts' },
]

const isUnder = (path: string, prefix: string) => (prefix === '/' ? path === '/' : path === prefix || path.startsWith(prefix + '/'))

export default function Layout() {
  const { addresses, accountIndex, address, selectAccount, addAccount, lock } = useWallet()
  const { pathname } = useLocation()
  const sub =
    SUBSCREENS.find((s) => isUnder(pathname, s.prefix)) ??
    (pathname.startsWith('/nfts/') ? { prefix: '/nfts/', title: 'NFT', back: '/nfts' } : undefined)

  return (
    <div className="stage">
      <LogoMark tone="inherit" className="stage-wallpaper" />
      <p className="stage-microtext" aria-hidden>
        Solana devnet · test tokens have no value
      </p>

      <div className="frame">
        <header className="masthead">
          <label className="relative flex min-w-0 cursor-pointer items-center gap-2.5 rounded-[6px] py-1 pr-2 hover:bg-plate/5">
            <span className="relative size-8 shrink-0 overflow-hidden rounded-full border border-plate/70 bg-note text-plate">
              <Rosette seed={address ?? 'wallet'} layers={2} detail={28} className="absolute inset-0 size-full" />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-semibold">Account {accountIndex + 1}</span>
              <span className="serial block truncate text-[10px] tracking-[0.04em] text-muted!">{address ? shortAddr(address, 4) : ''}</span>
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden />
            <select
              aria-label="Switch account"
              className="absolute inset-0 size-full cursor-pointer opacity-0"
              value={accountIndex}
              onChange={(e) => {
                if (e.target.value === 'new') void addAccount()
                else selectAccount(Number(e.target.value))
              }}
            >
              {addresses.map((a, i) => (
                <option key={a} value={i}>
                  Account {i + 1} · {shortAddr(a)}
                </option>
              ))}
              <option value="new">+ New account</option>
            </select>
          </label>

          <div className="flex items-center gap-2">
            <span className="chip" title="Test network: tokens here have no real value">
              <span className="size-1.5 rounded-full bg-serial" aria-hidden />
              {CLUSTER === 'devnet' ? 'Devnet' : CLUSTER}
            </span>
            <button
              className="grid size-9 place-items-center rounded-[6px] text-plate hover:bg-plate/8"
              onClick={lock}
              aria-label="Lock wallet"
              title="Lock wallet"
            >
              <Lock className="size-[18px]" />
            </button>
          </div>
        </header>

        <main className="page">
          {sub && (
            <div className="mb-5 flex items-center gap-1">
              <Link
                to={sub.back}
                className="-ml-2 grid size-9 place-items-center rounded-[6px] text-plate hover:bg-plate/8"
                aria-label="Back"
              >
                <ChevronLeft className="size-5" />
              </Link>
              <h1 className="text-xl font-semibold tracking-tight">{sub.title}</h1>
            </div>
          )}
          {/* remount on account switch so a half-finished form or receipt never carries over to another account */}
          <Outlet key={address} />
        </main>

        <nav className="tabbar" aria-label="Main">
          {TABS.map(({ to, label, icon: Icon, owns }) => {
            const active = owns.some((p) => isUnder(pathname, p))
            return (
              <NavLink key={to} to={to} className="tab" aria-current={active ? 'page' : undefined}>
                <Icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.7} aria-hidden />
                {label}
              </NavLink>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
