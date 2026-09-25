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
    <div className="space-y-7">
      <section className="space-y-3">
        <h2 className="font-semibold">Recovery phrase</h2>
        {seed ? (
          <>
            <ol className="grid grid-cols-3 gap-2">
              {seed.split(' ').map((w, i) => (
                <li key={i} className="flex items-baseline gap-1.5 rounded-[4px] border border-line bg-note px-2 py-1.5 text-sm">
                  <span className="serial w-4 shrink-0 text-right text-[10px]">{i + 1}</span>
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
            <p className="text-sm text-muted">These 12 words are your wallet. Enter your password to view them, and make sure nobody is watching.</p>
            <input
              className="input"
              type="password"
              placeholder="Password"
              aria-label="Password"
              autoComplete="current-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
            {error && <p className="text-sm text-serial">{error}</p>}
            <button className="btn-ghost w-full" disabled={!pw} onClick={reveal}>
              Show recovery phrase
            </button>
          </>
        )}
      </section>

      <hr className="rule" />

      <section className="space-y-1.5 text-sm">
        <h2 className="font-semibold">Network</h2>
        <p className="text-muted">Solana devnet, the practice network. Its money has no real value.</p>
        <p className="serial break-all text-[10px] text-muted!">{RPC_URL}</p>
      </section>

      <hr className="rule" />

      <section className="space-y-3">
        <h2 className="font-semibold text-serial">Remove wallet</h2>
        {!confirmReset ? (
          <button className="btn-danger w-full" onClick={() => setConfirmReset(true)}>
            Remove wallet from this device
          </button>
        ) : (
          <>
            <p className="text-sm text-muted">
              This deletes the encrypted wallet from this browser. Without your recovery phrase, you cannot get it back.
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
      </section>
    </div>
  )
}
