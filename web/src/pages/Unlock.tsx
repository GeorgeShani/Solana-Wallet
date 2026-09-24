import { useState, type FormEvent } from 'react'
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
      setError(err instanceof WrongPasswordError ? 'Wrong password.' : err instanceof Error ? err.message : 'Failed to unlock')
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-gradient-to-br from-accent to-accent2" />
        <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
      </div>
      <form className="card space-y-4" onSubmit={submit}>
        <div>
          <label className="label">Password</label>
          <input
            className="input"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button className="btn-primary w-full" disabled={busy || !pw}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>

      <div className="mt-6 text-center text-xs text-muted">
        {!confirmReset ? (
          <button className="underline" onClick={() => setConfirmReset(true)}>
            Forgot password?
          </button>
        ) : (
          <div className="card space-y-3 text-left">
            <p>
              The password can't be recovered. You can remove this wallet from the device and re-import it with your
              recovery phrase. <b className="text-white">Without the phrase, the funds are lost.</b>
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
    </div>
  )
}
