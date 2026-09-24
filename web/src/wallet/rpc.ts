import { address, isAddress } from '@solana/addresses'
import { signature } from '@solana/keys'
import { createSolanaRpc } from '@solana/rpc'
import { lamports } from '@solana/rpc-types'
import { RPC_URL } from '../config'

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
  kind: 'sent' | 'received' | 'other'
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

      const net = tokenDeltas.length ? tokenDeltas[0].delta : solDelta
      const kind = net > 0n ? 'received' : net < 0n ? 'sent' : 'other'
      return { ...base, failed: tx.meta.err != null, solDelta, tokenDeltas, kind }
    }),
  )
  return items
}
