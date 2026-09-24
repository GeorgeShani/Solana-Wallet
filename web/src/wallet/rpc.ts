import { address, isAddress } from '@solana/addresses'
import { signature } from '@solana/keys'
import { createSolanaRpc } from '@solana/rpc'
import { lamports } from '@solana/rpc-types'
import { PROGRAM_ADDRESS } from '@wallet/program-client'
import { WSOL_MINT } from '@wallet/shared'
import { RPC_URL, TOKEN_ACCOUNT_SIZE } from '../config'
import { TransactionFailedError } from '../lib/errors'

export const rpc = createSolanaRpc(RPC_URL)

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'

export const validAddress = (a: string) => isAddress(a.trim())

export async function getSolBalance(owner: string): Promise<bigint> {
  const res = await rpc.getBalance(address(owner), { commitment: 'confirmed' }).send()
  return res.value
}

export interface TokenHolding {
  mint: string
  amount: bigint
  decimals: number
  tokenAccount: string
}

interface ParsedTokenAccount {
  pubkey: string
  account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number } } } } }
}

/** All SPL / Token-2022 balances owned by `owner` (may include zero balances). */
export async function getTokenHoldings(owner: string): Promise<TokenHolding[]> {
  const results = await Promise.all(
    [TOKEN_PROGRAM, TOKEN_2022_PROGRAM].map((program) =>
      rpc
        .getTokenAccountsByOwner(
          address(owner),
          { programId: address(program) },
          { encoding: 'jsonParsed', commitment: 'confirmed' },
        )
        .send(),
    ),
  )
  return results.flatMap((r) =>
    (r.value as unknown as ParsedTokenAccount[]).map((v) => {
      const info = v.account.data.parsed.info
      return {
        mint: info.mint,
        amount: BigInt(info.tokenAmount.amount),
        decimals: info.tokenAmount.decimals,
        tokenAccount: String(v.pubkey),
      }
    }),
  )
}

/** Does `owner` already have a token account for `mint`? (Decides whether a send must create one.) */
export async function hasTokenAccount(owner: string, mint: string): Promise<boolean> {
  const res = await rpc
    .getTokenAccountsByOwner(address(owner), { mint: address(mint) }, { encoding: 'base64', commitment: 'confirmed' })
    .send()
  return res.value.length > 0
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Wait until the network has confirmed `sig`. Throws TransactionFailedError if it was included
 * but failed (WDK only broadcasts; without this a failed swap would look like a success).
 */
export async function confirmSignature(sig: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { value } = await rpc.getSignatureStatuses([signature(sig)]).send()
    const status = value[0]
    if (status?.err) throw new TransactionFailedError(status.err)
    if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) return
    await sleep(1000)
  }
  throw new Error('Timed out waiting for the network to confirm this transaction. It may still go through; check Activity.')
}

/** Raw data of several accounts in one request (null for accounts that don't exist). */
export async function getAccountsData(addresses: string[]): Promise<(Uint8Array | null)[]> {
  const { value } = await rpc
    .getMultipleAccounts(addresses.map((a) => address(a)), { encoding: 'base64', commitment: 'confirmed' })
    .send()
  return value.map((v) => (v ? Uint8Array.from(atob(v.data[0]), (c) => c.charCodeAt(0)) : null))
}

const rentCache = new Map<bigint, Promise<bigint>>()

/** Rent-exempt minimum for an account with `dataLength` bytes, as currently set by the cluster. */
export function getRentExemption(dataLength: bigint): Promise<bigint> {
  let p = rentCache.get(dataLength)
  if (!p) {
    p = rpc.getMinimumBalanceForRentExemption(dataLength, { commitment: 'confirmed' }).send().then((v) => BigInt(v))
    p.catch(() => rentCache.delete(dataLength))
    rentCache.set(dataLength, p)
  }
  return p
}

export async function requestAirdrop(to: string, lamportAmount: bigint): Promise<string> {
  return rpc.requestAirdrop(address(to), lamports(lamportAmount), { commitment: 'confirmed' }).send()
}

export interface HistoryItem {
  signature: string
  blockTime: number | null
  failed: boolean
  /** Net SOL change for the owner, fee included (lamports). */
  solDelta: bigint
  tokenDeltas: { mint: string; delta: bigint; decimals: number }[]
  kind: 'sent' | 'received' | 'swap' | 'other'
}

interface RawTokenBalance {
  accountIndex: number
  mint: string
  owner?: string
  uiTokenAmount: { amount: string; decimals: number }
}

/** Recent activity for `owner`, derived from each transaction's pre/post balances. */
export async function getHistory(owner: string, limit = 15): Promise<HistoryItem[]> {
  const sigs = await rpc.getSignaturesForAddress(address(owner), { limit, commitment: 'confirmed' }).send()
  const items = await Promise.all(
    sigs.map(async (s): Promise<HistoryItem> => {
      const base = { signature: String(s.signature), blockTime: s.blockTime == null ? null : Number(s.blockTime) }
      const tx = await rpc
        .getTransaction(signature(String(s.signature)), {
          encoding: 'jsonParsed',
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed',
        })
        .send()
      if (!tx || !tx.meta) {
        return { ...base, failed: s.err != null, solDelta: 0n, tokenDeltas: [], kind: 'other' }
      }
      const keys = (tx.transaction.message.accountKeys as unknown as { pubkey: string }[]).map((k) => String(k.pubkey))
      const idx = keys.indexOf(owner)
      const solDelta = idx >= 0 ? BigInt(tx.meta.postBalances[idx]) - BigInt(tx.meta.preBalances[idx]) : 0n

      const pre = (tx.meta.preTokenBalances ?? []) as unknown as RawTokenBalance[]
      const post = (tx.meta.postTokenBalances ?? []) as unknown as RawTokenBalance[]
      const perMint = new Map<string, { delta: bigint; decimals: number }>()
      for (const b of post.filter((b) => b.owner === owner)) {
        const cur = perMint.get(b.mint) ?? { delta: 0n, decimals: b.uiTokenAmount.decimals }
        cur.delta += BigInt(b.uiTokenAmount.amount)
        perMint.set(b.mint, cur)
      }
      for (const b of pre.filter((b) => b.owner === owner)) {
        const cur = perMint.get(b.mint) ?? { delta: 0n, decimals: b.uiTokenAmount.decimals }
        cur.delta -= BigInt(b.uiTokenAmount.amount)
        perMint.set(b.mint, cur)
      }
      const tokenDeltas = [...perMint].map(([mint, v]) => ({ mint, ...v })).filter((d) => d.delta !== 0n)

      const failed = tx.meta.err != null

      // A swap through our program moves two assets. Show both legs, with the SOL leg cleaned of
      // the network fee and of rent paid to open new token accounts, so 0.5 SOL in reads as 0.5.
      if (keys.includes(String(PROGRAM_ADDRESS)) && !failed) {
        const opened = post.filter(
          (b) => b.owner === owner && !pre.some((p) => p.accountIndex === b.accountIndex),
        ).length
        const feePaid = idx === 0 ? BigInt(tx.meta.fee) : 0n
        const rent = opened > 0 ? BigInt(opened) * (await getRentExemption(TOKEN_ACCOUNT_SIZE)) : 0n
        const solLeg = solDelta + feePaid + rent
        const legs = solLeg !== 0n ? [...tokenDeltas, { mint: WSOL_MINT, delta: solLeg, decimals: 9 }] : tokenDeltas
        return { ...base, failed, solDelta, tokenDeltas: legs, kind: 'swap' }
      }

      const net = tokenDeltas.length ? tokenDeltas[0].delta : solDelta
      const kind = net > 0n ? 'received' : net < 0n ? 'sent' : 'other'
      return { ...base, failed, solDelta, tokenDeltas, kind }
    }),
  )
  return items
}
