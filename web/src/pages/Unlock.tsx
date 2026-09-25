import { useState, type FormEvent } from 'react'
import AuthShell from '../components/AuthShell'
import { useWallet } from '../wallet/WalletContext'
import { WrongPasswordError } from '../wallet/vaultCrypto'

export default function Unlock() {
  const { unlock, reset } = useWallet()
  const [pw, setPw] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await unlock(pw)
    } catch (err) {
      setError(err instanceof WrongPasswordError ? 'That password is not right. Try again.' : err instanceof Error ? err.message : 'Failed to unlock')
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Welcome back" subtitle="Enter your password to open your wallet.">
      <form className="space-y-4" onSubmit={submit}>
        <div>
          <label className="label" htmlFor="pw">
            Password
          </label>
          <input
            id="pw"
            className="input"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
        </div>
        {error && (
          <p className="text-sm text-serial" role="alert">
            {error}
          </p>
        )}
        <button className="btn-primary w-full" disabled={busy || !pw}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>

      <div className="mt-auto pt-8 text-center text-[13px] text-muted">
        {!confirmReset ? (
          <button className="link font-normal!" onClick={() => setConfirmReset(true)}>
            Forgot your password?
          </button>
        ) : (
          <div className="card space-y-3 text-left">
            <p>
              Passwords can’t be recovered. You can remove this wallet from the device and bring it back with your recovery
              phrase. <b className="text-ink">Without the phrase, the money is gone for good.</b>
            </p>
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
              <button className="btn-danger flex-1" onClick={() => void reset()}>
                Remove wallet
              </button>
            </div>
          </div>
        )}
      </div>
    </AuthShell>
  )
}
