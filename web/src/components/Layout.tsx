import { NavLink, Outlet } from 'react-router-dom'
import { CLUSTER } from '../config'
import { shortAddr } from '../lib/format'
import { useWallet } from '../wallet/WalletContext'

const NAV = [
  { to: '/', label: 'Wallet', end: true },
  { to: '/send', label: 'Send' },
  { to: '/receive', label: 'Receive' },
  { to: '/activity', label: 'Activity' },
  { to: '/settings', label: 'Settings' },
]

export default function Layout() {
  const { addresses, accountIndex, selectAccount, addAccount, lock } = useWallet()

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col px-4 pb-10">
      <header className="flex items-center justify-between gap-3 py-5">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-accent to-accent2" />
          <span className="font-bold tracking-tight">Solana Wallet</span>
          <span className="rounded-full border border-accent2/40 px-2 py-0.5 text-[10px] font-semibold uppercase text-accent2">
            {CLUSTER}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Account"
            className="rounded-lg border border-line bg-panel px-2 py-1.5 text-xs"
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
          <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={lock}>
            Lock
          </button>
        </div>
      </header>

      <nav className="mb-5 flex gap-1 rounded-xl border border-line bg-panel p-1">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              `flex-1 rounded-lg px-2 py-2 text-center text-sm font-medium transition ${
                isActive ? 'bg-white/10 text-white' : 'text-muted hover:text-white'
              }`
            }
          >
            {n.label}
          </NavLink>
        ))}
      </nav>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
