import { DEVNET, WSOL_MINT } from '@wallet/shared'

export const CLUSTER = 'devnet' as const
export const RPC_URL: string = import.meta.env.VITE_RPC_URL ?? 'https://api.devnet.solana.com'

export const LAMPORTS_PER_SOL = 1_000_000_000n
export const SOL_DECIMALS = 9
/** Data sizes used to ask the network for rent-exempt minimums (rent params change; never hard-code lamports). */
export const SYSTEM_ACCOUNT_SIZE = 0n
export const TOKEN_ACCOUNT_SIZE = 165n

export const INACTIVITY_LOCK_MS = 5 * 60 * 1000

export interface TokenInfo {
  mint: string
  symbol: string
  name: string
  decimals: number
}

/** Tokens we can label: Circle's devnet USDC plus the test tokens our AMM pools trade. */
export const KNOWN_TOKENS: TokenInfo[] = [
  {
    mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    symbol: 'USDC',
    name: 'USDC (devnet)',
    decimals: 6,
  },
  ...DEVNET.tokens
    .filter((t) => t.mint !== WSOL_MINT)
    .map((t) => ({ mint: t.mint, symbol: t.symbol, name: t.name, decimals: t.decimals })),
]

export const tokenByMint = (mint: string) => KNOWN_TOKENS.find((t) => t.mint === mint)

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`
export const explorerAddress = (addr: string) => `https://explorer.solana.com/address/${addr}?cluster=${CLUSTER}`
