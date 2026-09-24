import * as bip39 from 'bip39'
import { useMemo, useState } from 'react'
import { useWallet } from '../wallet/WalletContext'

type Step = 'choose' | 'show' | 'confirm' | 'import' | 'password'

const pickPositions = (n: number, total: number) => {
  const set = new Set<number>()
  while (set.size < n) set.add(crypto.getRandomValues(new Uint32Array(1))[0] % total)
  return [...set].sort((a, b) => a - b)
}

export default function Onboarding() {
  const { createWallet } = useWallet()
  const [step, setStep] = useState<Step>('choose')
  const [seed, setSeed] = useState('')
  const [importText, setImportText] = useState('')
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [saved, setSaved] = useState(false)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const words = useMemo(() => seed.split(' ').filter(Boolean), [seed])
  const positions = useMemo(() => (words.length ? pickPositions(3, words.length) : []), [words])

  const startCreate = () => {
    setSeed(bip39.generateMnemonic(128))
    setSaved(false)
    setAnswers({})
    setError('')
    setStep('show')
  }

  const checkConfirm = () => {
    const ok = positions.every((p) => (answers[p] ?? '').trim().toLowerCase() === words[p])
    if (!ok) return setError('Those words do not match your recovery phrase. Check your backup and try again.')
    setError('')
    setStep('password')
  }

  const checkImport = () => {
    const normalized = importText.trim().toLowerCase().split(/\s+/).join(' ')
    if (!bip39.validateMnemonic(normalized)) return setError('Invalid recovery phrase. Check the words and their order.')
    setSeed(normalized)
    setError('')
    setStep('password')
  }

  const finish = async () => {
    if (pw.length < 8) return setError('Use at least 8 characters.')
    if (pw !== pw2) return setError('Passwords do not match.')
    setBusy(true)
    setError('')
    try {
      await createWallet(seed, pw)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create wallet')
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-gradient-to-br from-accent to-accent2" />
        <h1 className="text-2xl font-bold tracking-tight">Solana Wallet</h1>
        <p className="mt-1 text-sm text-muted">A self-custodial wallet on Solana devnet</p>
      </div>

      {step === 'choose' && (
        <div className="card space-y-3">
          <button className="btn-primary w-full" onClick={startCreate}>
            Create a new wallet
          </button>
          <button
            className="btn-ghost w-full"
            onClick={() => {
              setError('')
              setStep('import')
            }}
          >
            I already have a recovery phrase
          </button>
          <p className="pt-2 text-xs text-muted">
            Your keys are generated and encrypted in this browser. Nobody else, including us, can recover them for you.
          </p>
        </div>
      )}

      {step === 'show' && (
        <div className="card space-y-4">
          <h2 className="font-semibold">Your recovery phrase</h2>
          <p className="text-sm text-muted">
            These 12 words <b className="text-white">are</b> your wallet. Write them down and keep them offline. Anyone with
            them can take your funds, and if you lose them, nobody can restore access.
          </p>
          <ol className="grid grid-cols-3 gap-2">
            {words.map((w, i) => (
              <li key={i} className="rounded-lg border border-line bg-ink px-2 py-1.5 text-sm">
                <span className="mr-1.5 text-xs text-muted">{i + 1}</span>
                {w}
              </li>
            ))}
          </ol>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            I have written it down somewhere safe.
          </label>
          <button className="btn-primary w-full" disabled={!saved} onClick={() => setStep('confirm')}>
            Continue
          </button>
        </div>
      )}

      {step === 'confirm' && (
        <div className="card space-y-4">
          <h2 className="font-semibold">Confirm your backup</h2>
          <p className="text-sm text-muted">Enter the requested words from your recovery phrase.</p>
          {positions.map((p) => (
            <div key={p}>
              <label className="label">Word #{p + 1}</label>
              <input
                className="input"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={answers[p] ?? ''}
                onChange={(e) => setAnswers({ ...answers, [p]: e.target.value })}
              />
            </div>
          ))}
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => setStep('show')}>
              Back
            </button>
            <button className="btn-primary flex-1" onClick={checkConfirm}>
              Confirm
            </button>
          </div>
        </div>
      )}

      {step === 'import' && (
        <div className="card space-y-4">
          <h2 className="font-semibold">Import a wallet</h2>
          <div>
            <label className="label">Recovery phrase (12 or 24 words)</label>
            <textarea
              className="input h-28 resize-none"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => setStep('choose')}>
              Back
            </button>
            <button className="btn-primary flex-1" disabled={!importText.trim()} onClick={checkImport}>
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 'password' && (
        <div className="card space-y-4">
          <h2 className="font-semibold">Set a password</h2>
          <p className="text-sm text-muted">
            It encrypts your recovery phrase on this device and unlocks the wallet. It cannot recover a lost phrase.
          </p>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <div>
            <label className="label">Confirm password</label>
            <input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button className="btn-primary w-full" disabled={busy} onClick={finish}>
            {busy ? 'Encrypting…' : 'Create wallet'}
          </button>
        </div>
      )}
    </div>
  )
}
