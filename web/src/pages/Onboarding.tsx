import * as bip39 from 'bip39'
import { ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import AuthShell from '../components/AuthShell'
import { useWallet } from '../wallet/WalletContext'

type Step = 'choose' | 'show' | 'confirm' | 'import' | 'password'

const pickPositions = (n: number, total: number) => {
  const set = new Set<number>()
  while (set.size < n) set.add(crypto.getRandomValues(new Uint32Array(1))[0] % total)
  return [...set].sort((a, b) => a - b)
}

const TITLES: Record<Step, { title: string; subtitle?: string }> = {
  choose: { title: 'Solana Wallet', subtitle: 'Your own money, held only by you. Practice on Solana’s test network, risk-free.' },
  show: { title: 'Your recovery phrase', subtitle: 'Step 1 of 3' },
  confirm: { title: 'Check your backup', subtitle: 'Step 2 of 3' },
  import: { title: 'Bring your wallet', subtitle: 'Use the recovery phrase you saved.' },
  password: { title: 'Set a password', subtitle: 'Last step' },
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
    if (!bip39.validateMnemonic(normalized)) return setError('That recovery phrase is not valid. Check the words and their order.')
    setSeed(normalized)
    setError('')
    setStep('password')
  }

  const finish = async () => {
    if (pw.length < 8) return setError('Use at least 8 characters.')
    if (pw !== pw2) return setError('The two passwords are different.')
    setBusy(true)
    setError('')
    try {
      await createWallet(seed, pw)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the wallet')
      setBusy(false)
    }
  }

  const { title, subtitle } = TITLES[step]
  const err = error && (
    <p className="text-sm text-serial" role="alert">
      {error}
    </p>
  )

  return (
    <AuthShell title={title} subtitle={subtitle}>
      {step === 'choose' && (
        <div className="space-y-3">
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
          <p className="flex items-start gap-2 pt-3 text-[13px] text-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-plate" aria-hidden />
            Your keys are made and locked inside this browser. Nobody else, including us, can recover them for you.
          </p>
        </div>
      )}

      {step === 'show' && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            These 12 words <b className="text-ink">are</b> your wallet. Write them down and keep them offline. Anyone who has them can take your money, and if you lose them, nobody can bring it back.
          </p>
          <ol className="grid grid-cols-3 gap-2">
            {words.map((w, i) => (
              <li key={i} className="flex items-baseline gap-1.5 rounded-[4px] border border-line bg-note px-2 py-2 text-sm">
                <span className="serial w-4 shrink-0 text-right text-[10px]">{i + 1}</span>
                {w}
              </li>
            ))}
          </ol>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-0.5" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I have written them down somewhere safe.
          </label>
          <button className="btn-primary w-full" disabled={!saved} onClick={() => setStep('confirm')}>
            Continue
          </button>
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-4">
          <p className="text-sm text-muted">Type these words from your recovery phrase, so we know the backup works.</p>
          {positions.map((p) => (
            <div key={p}>
              <label className="label" htmlFor={`w${p}`}>
                Word number {p + 1}
              </label>
              <input
                id={`w${p}`}
                className="input"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={answers[p] ?? ''}
                onChange={(e) => setAnswers({ ...answers, [p]: e.target.value })}
              />
            </div>
          ))}
          {err}
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
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="phrase">
              Recovery phrase (12 or 24 words)
            </label>
            <textarea
              id="phrase"
              className="input h-28 resize-none"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
          </div>
          {err}
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
        <div className="space-y-4">
          <p className="text-sm text-muted">It locks your recovery phrase on this device and opens the wallet. It cannot recover a lost phrase.</p>
          <div>
            <label className="label" htmlFor="pw1">
              Password
            </label>
            <input id="pw1" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="pw2">
              Type it again
            </label>
            <input id="pw2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </div>
          {err}
          <button className="btn-primary w-full" disabled={busy} onClick={finish}>
            {busy ? 'Locking it up…' : 'Create wallet'}
          </button>
        </div>
      )}
    </AuthShell>
  )
}
