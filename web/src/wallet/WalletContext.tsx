import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { INACTIVITY_LOCK_MS } from '../config'
import { decryptSeed, encryptSeed } from './vaultCrypto'
import { deleteVault, loadVault, saveVault } from './vaultStorage'
import { WalletService } from './walletService'

type Status = 'loading' | 'empty' | 'locked' | 'unlocked'

interface WalletCtx {
  status: Status
  service: WalletService | null
  /** Derived addresses for accounts 0..accountCount-1 (only while unlocked). */
  addresses: string[]
  accountIndex: number
  address: string | null
  createWallet: (seed: string, password: string) => Promise<void>
  unlock: (password: string) => Promise<void>
  lock: () => void
  /** Deletes the encrypted seed from this device. Irreversible without the seed phrase. */
  reset: () => Promise<void>
  revealSeed: (password: string) => Promise<string>
  selectAccount: (i: number) => void
  addAccount: () => Promise<void>
}

const Ctx = createContext<WalletCtx | null>(null)

const COUNT_KEY = 'accountCount'
const readCount = () => {
  try {
    return Math.max(1, Number(localStorage.getItem(COUNT_KEY)) || 1)
  } catch {
    return 1
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [service, setService] = useState<WalletService | null>(null)
  const [addresses, setAddresses] = useState<string[]>([])
  const [accountIndex, setAccountIndex] = useState(0)
  const serviceRef = useRef<WalletService | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    loadVault()
      .then((v) => setStatus((s) => (s === 'unlocked' ? s : v ? 'locked' : 'empty')))
      .catch(() => setStatus((s) => (s === 'unlocked' ? s : 'empty')))
  }, [])

  const open = useCallback(async (seed: string, opts?: { accountIndex?: number }) => {
    const svc = new WalletService(seed)
    const index = opts?.accountIndex ?? 0
    const count = Math.max(readCount(), index + 1)
    const addrs = await Promise.all(Array.from({ length: count }, (_, i) => svc.getAddress(i)))
    serviceRef.current = svc
    setService(svc)
    setAddresses(addrs)
    setAccountIndex(index)
    setStatus('unlocked')
  }, [])

  // DEV ONLY (stripped from production builds): open a throwaway test wallet straight from
  // `?e2eSeed=<recovery phrase>` so automated checks and screenshots don't need the password UI.
  // It never touches the stored vault.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const params = new URLSearchParams(location.search)
    const seed = params.get('e2eSeed')
    if (seed) void Promise.resolve().then(() => open(seed, { accountIndex: Number(params.get('e2eAccount') ?? 0) || 0 }))
  }, [open])

  const lock = useCallback(() => {
    serviceRef.current?.dispose()
    serviceRef.current = null
    // private-payment keys are cached under 'stealth' queries: drop them so nothing secret outlives the unlock
    queryClient.removeQueries({ queryKey: ['stealth'] })
    setService(null)
    setAddresses([])
    setStatus((s) => (s === 'unlocked' ? 'locked' : s))
  }, [queryClient])

  const createWallet = useCallback(
    async (seed: string, password: string) => {
      await saveVault(await encryptSeed(seed, password))
      try {
        localStorage.setItem(COUNT_KEY, '1')
      } catch {
        /* storage unavailable: falls back to 1 account */
      }
      await open(seed)
    },
    [open],
  )

  const unlock = useCallback(
    async (password: string) => {
      const vault = await loadVault()
      if (!vault) throw new Error('No wallet found on this device')
      await open(await decryptSeed(vault, password))
    },
    [open],
  )

  const reset = useCallback(async () => {
    lock()
    await deleteVault()
    try {
      localStorage.removeItem(COUNT_KEY)
    } catch {
      /* ignore */
    }
    setStatus('empty')
  }, [lock])

  const revealSeed = useCallback(async (password: string) => {
    const vault = await loadVault()
    if (!vault) throw new Error('No wallet found on this device')
    return decryptSeed(vault, password)
  }, [])

  const addAccount = useCallback(async () => {
    const svc = serviceRef.current
    if (!svc) return
    const next = addresses.length
    const addr = await svc.getAddress(next)
    setAddresses((a) => [...a, addr])
    setAccountIndex(next)
    try {
      localStorage.setItem(COUNT_KEY, String(next + 1))
    } catch {
      /* ignore */
    }
  }, [addresses.length])

  // Auto-lock after a period of inactivity while unlocked.
  useEffect(() => {
    if (status !== 'unlocked') return
    let timer = setTimeout(lock, INACTIVITY_LOCK_MS)
    const bump = () => {
      clearTimeout(timer)
      timer = setTimeout(lock, INACTIVITY_LOCK_MS)
    }
    const events = ['pointerdown', 'keydown', 'scroll'] as const
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    return () => {
      clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, bump))
    }
  }, [status, lock])

  const value = useMemo<WalletCtx>(
    () => ({
      status,
      service,
      addresses,
      accountIndex,
      address: addresses[accountIndex] ?? null,
      createWallet,
      unlock,
      lock,
      reset,
      revealSeed,
      selectAccount: setAccountIndex,
      addAccount,
    }),
    [status, service, addresses, accountIndex, createWallet, unlock, lock, reset, revealSeed, addAccount],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWallet() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>')
  return ctx
}
