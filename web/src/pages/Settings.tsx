import { useState } from 'react'
import { RPC_URL } from '../config'
import { WrongPasswordError } from '../wallet/vaultCrypto'
import { useWallet } from '../wallet/WalletContext'

export default function Settings() {
  const { revealSeed, reset } = useWallet()
  const [pw, setPw] = useState('')
  const [seed, setSeed] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)

  const reveal = async () => {
    setError('')
    try {
      setSeed(await revealSeed(pw))
      setPw('')
    } catch (e) {
      setError(e instanceof WrongPasswordError ? 'Wrong password.' : 'Could not decrypt the wallet.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h2 className="font-semibold">Recovery phrase</h2>
        {seed ? (
          <>
            <ol className="grid grid-cols-3 gap-2">
              {seed.split(' ').map((w, i) => (
                <li key={i} className="rounded-lg border border-line bg-ink px-2 py-1.5 text-sm">
                  <span className="mr-1.5 text-xs text-muted">{i + 1}</span>
                  {w}
                </li>
              ))}
            </ol>
            <button className="btn-ghost w-full" onClick={() => setSeed(null)}>
              Hide
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">Enter your password to view your phrase. Make sure nobody is watching.</p>
            <input
              className="input"
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button className="btn-ghost w-full" disabled={!pw} onClick={reveal}>
              Reveal
            </button>
          </>
        )}
      </div>

      <div className="card space-y-2 text-sm">
        <h2 className="font-semibold">Network</h2>
        <p className="text-muted">
          Solana devnet · <span className="font-mono text-xs">{RPC_URL}</span>
        </p>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold text-red-300">Danger zone</h2>
        {!confirmReset ? (
          <button className="btn-danger w-full" onClick={() => setConfirmReset(true)}>
            Remove wallet from this device
          </button>
        ) : (
          <>
            <p className="text-sm text-muted">
              This deletes the encrypted wallet from this browser. You can only restore it with your recovery phrase.
            </p>
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
              <button className="btn-danger flex-1" onClick={() => void reset()}>
                Yes, remove it
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
