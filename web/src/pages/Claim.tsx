import { address as toAddress } from '@solana/addresses'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { getRelayFeePayer, relayTransaction } from '../api'
import AuthShell from '../components/AuthShell'
import { CLUSTER } from '../config'
import { friendlyError } from '../lib/errors'
import { formatUnits, shortAddr } from '../lib/format'
import { buildClaimTransaction, fetchLink } from '../links/chain'
import { parseLinkSecret } from '../links/secret'
import { timeLeft, useTokenMeta } from '../links/useTokenMeta'
import { Band } from '../ui/Guilloche'
import Receipt from '../ui/Receipt'
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
    <AuthShell title="Claim your funds" subtitle={`Solana ${CLUSTER} · test tokens only`}>
      <div className="space-y-5">
        {secretQuery.isLoading || (secret && linkQuery.isLoading) ? (
          <p className="text-center text-sm text-muted">Checking the link…</p>
        ) : !secret ? (
          <Problem title="This link isn’t valid" text="It may have been cut off when it was copied. Ask the sender for the full link." />
        ) : linkQuery.error ? (
          <Problem title="Couldn’t check the link" text="The network didn’t answer. Refresh the page to try again." />
        ) : claimed ? (
          <Receipt
            title="Claimed"
            signature={claimed.sig}
            lines={[
              { label: 'Amount', value: claimed.amount ?? 'Your funds' },
              { label: 'Sent to', value: <span className="serial break-all">{shortAddr(recipient.trim(), 6)}</span> },
            ]}
          >
            {walletAddress && recipient.trim() === walletAddress && (
              <Link to="/" className="btn-primary flex-1">
                Open my wallet
              </Link>
            )}
          </Receipt>
        ) : !link ? (
          <Problem
            title="Nothing to claim here"
            text="This link has already been claimed, was cancelled by the sender, or never existed."
          />
        ) : (
          <>
            <div className="banknote rise px-5 pt-16 pb-5 text-center">
              <Band seed={link.claimKey} className="absolute inset-x-0 top-0 h-14 w-full text-plate/50" draw />
              <div className="numeral text-[40px] leading-none">{amount ?? '…'}</div>
              <p className="mt-2 text-sm text-muted">is waiting for you</p>
              <p className="serial mt-3 text-[10px]">
                from {shortAddr(link.sender, 4)} · {timeLeft(link.expiry)}
              </p>
            </div>

            {expired ? (
              <p className="rounded-[6px] border border-caution/50 bg-caution/10 p-3 text-sm text-caution">
                This link has expired, so it can’t be claimed any more. Ask the sender to cancel it and send you a new one.
              </p>
            ) : (
              <>
                <div>
                  <label className="label" htmlFor="claim-to">
                    Send it to this address
                  </label>
                  <input
                    id="claim-to"
                    className="input font-serial text-[13px]"
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
                        : 'Paste an address, or create a wallet first (then come back to this page). You don’t need any SOL.'}
                  </p>
                </div>
                {error && (
                  <p className="text-sm text-serial" role="alert">
                    {error}
                  </p>
                )}
                {busy && <div className="inking" role="status" aria-label="Claiming" />}
                <button className="btn-primary w-full" disabled={busy || !recipient.trim()} onClick={claim}>
                  {busy ? 'Claiming…' : 'Claim'}
                </button>
                {!walletAddress && (
                  <Link to="/" className="link block text-center text-xs">
                    {status === 'locked' ? 'Unlock my wallet' : 'Create a wallet'}
                  </Link>
                )}
              </>
            )}
          </>
        )}
      </div>
    </AuthShell>
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
