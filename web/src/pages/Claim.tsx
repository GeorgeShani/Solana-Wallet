import { address as toAddress } from '@solana/addresses'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { getRelayFeePayer, relayTransaction } from '../api'
import { CLUSTER, explorerTx } from '../config'
import { friendlyError } from '../lib/errors'
import { formatUnits, shortAddr } from '../lib/format'
import { buildClaimTransaction, fetchLink } from '../links/chain'
import { parseLinkSecret } from '../links/secret'
import { timeLeft, useTokenMeta } from '../links/useTokenMeta'
import { confirmSignature, validAddress } from '../wallet/rpc'
import { useWallet } from '../wallet/WalletContext'

/**
 * Public page opened from a claim link (`/claim#<secret>`). It needs no wallet: the person can
 * paste any address. The secret is used only in this browser to sign the claim; the network
 * fee is paid by the wallet's relayer, so the recipient needs no SOL.
 */
export default function Claim() {
  const { hash } = useLocation()
  const { address: walletAddress, status } = useWallet()

  const secretQuery = useQuery({
    queryKey: ['linkSecret', hash],
    queryFn: () => parseLinkSecret(hash),
    staleTime: Infinity,
  })
  const secret = secretQuery.data ?? null

  const linkQuery = useQuery({
    queryKey: ['link', secret?.claimKey],
    enabled: !!secret,
    refetchInterval: 15_000,
    queryFn: () => fetchLink(secret!.claimKey),
  })
  const link = linkQuery.data ?? null
  const { data: tokenMeta } = useTokenMeta(link?.mint ?? null)

  // What the person typed, or (until they type) the unlocked wallet's address.
  const [typed, setTyped] = useState<string | null>(null)
  const recipient = typed ?? walletAddress ?? ''
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Remembered at claim time: once claimed, the link account is gone and can't be read back.
  const [claimed, setClaimed] = useState<{ sig: string; amount: string | null } | null>(null)

  const amount = link && tokenMeta ? `${formatUnits(link.amount, tokenMeta.decimals, 6)} ${tokenMeta.symbol}` : null

  const claim = async () => {
    if (!secret || !link) return
    setError('')
    const to = recipient.trim()
    if (!validAddress(to)) return setError('Enter a valid Solana address to receive the funds.')
    setBusy(true)
    try {
      const feePayer = toAddress(await getRelayFeePayer())
      const tx = await buildClaimTransaction({ link, secret, recipient: toAddress(to), feePayer })
      const sig = await relayTransaction(tx)
      await confirmSignature(sig)
      setClaimed({ sig, amount })
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const expired = link ? timeLeft(link.expiry) === 'Expired' : false

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-gradient-to-br from-accent to-accent2" />
        <h1 className="text-xl font-bold tracking-tight">Claim your funds</h1>
        <p className="mt-1 text-xs text-muted">Solana {CLUSTER} · test tokens only</p>
      </div>

      <div className="card space-y-4">
        {secretQuery.isLoading || (secret && linkQuery.isLoading) ? (
          <p className="text-sm text-muted">Checking the link…</p>
        ) : !secret ? (
          <Problem title="This link isn't valid" text="It may have been cut off when it was copied. Ask the sender for the full link." />
        ) : linkQuery.error ? (
          <Problem title="Couldn't check the link" text="The network didn't answer. Refresh the page to try again." />
        ) : claimed ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent2/15 text-2xl text-accent2">✓</div>
            <h2 className="text-lg font-semibold">Claimed</h2>
            <p className="text-sm text-muted">
              {claimed.amount ?? 'Your funds'} {claimed.amount ? 'was' : 'were'} sent to <span className="font-mono">{shortAddr(recipient.trim(), 6)}</span>.
            </p>
            <a className="block text-sm text-accent underline" href={explorerTx(claimed.sig)} target="_blank" rel="noreferrer">
              View on Solana Explorer
            </a>
            {walletAddress && recipient.trim() === walletAddress && (
              <Link to="/" className="btn-primary w-full">
                Open my wallet
              </Link>
            )}
          </div>
        ) : !link ? (
          <Problem
            title="Nothing to claim here"
            text="This link has already been claimed, was cancelled by the sender, or never existed."
          />
        ) : (
          <>
            <div className="text-center">
              <div className="text-xs uppercase tracking-wide text-muted">You received</div>
              <div className="mt-1 text-3xl font-bold tracking-tight">{amount ?? '…'}</div>
              <div className="mt-1 text-xs text-muted">
                from {shortAddr(link.sender, 4)} · {timeLeft(link.expiry)}
              </div>
            </div>

            {expired ? (
              <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200">
                This link has expired, so it can't be claimed any more. Ask the sender to cancel it and send you a new one.
              </p>
            ) : (
              <>
                <div>
                  <label className="label">Send it to this address</label>
                  <input
                    className="input font-mono"
                    placeholder="Your Solana address"
                    autoComplete="off"
                    spellCheck={false}
                    value={recipient}
                    onChange={(e) => setTyped(e.target.value)}
                  />
                  <p className="mt-1.5 text-xs text-muted">
                    {walletAddress
                      ? 'Filled in from your wallet. You can use any address.'
                      : status === 'locked'
                        ? 'Your wallet is locked. Paste an address, or unlock it (then come back to this page).'
                        : "Paste an address, or create a wallet first (then come back to this page). You don't need any SOL."}
                  </p>
                </div>
                {error && <p className="text-sm text-red-400">{error}</p>}
                <button className="btn-primary w-full" disabled={busy || !recipient.trim()} onClick={claim}>
                  {busy ? 'Claiming…' : 'Claim'}
                </button>
                {!walletAddress && (
                  <Link to="/" className="block text-center text-xs text-accent underline">
                    {status === 'locked' ? 'Unlock my wallet' : 'Create a wallet'}
                  </Link>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Problem({ title, text }: { title: string; text: string }) {
  return (
    <div className="space-y-2 text-center">
      <h2 className="font-semibold">{title}</h2>
      <p className="text-sm text-muted">{text}</p>
    </div>
  )
}
