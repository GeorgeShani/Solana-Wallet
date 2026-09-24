// Client for the wallet's Hono backend (faucet, prices, fee relayer).

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export class ApiError extends Error {
  readonly status: number
  readonly retryAfterSeconds?: number
  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    })
  } catch {
    throw new ApiError('Could not reach the wallet server. Is it running?', 0)
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; retryAfterSeconds?: number }
  if (!res.ok) throw new ApiError(body.error ?? `Server error (${res.status})`, res.status, body.retryAfterSeconds)
  return body as T
}

export interface Prices {
  solUsd: number | null
  updatedAt: number | null
  stale: boolean
}
export const getPrices = () => request<Prices>('/prices')

export interface FaucetResult {
  signature: string
  tokens: { symbol: string; amount: string; decimals: number }[]
}
export const claimFaucet = (address: string) =>
  request<FaucetResult>('/faucet', { method: 'POST', body: JSON.stringify({ address }) })

/** The address that pays fees for relayed transactions. */
export const getRelayFeePayer = async () => (await request<{ feePayer: string }>('/relay/info')).feePayer

/** Sends a transaction (signed by everyone except the fee payer) to be co-signed and broadcast. */
export const relayTransaction = async (base64: string) =>
  (await request<{ signature: string }>('/relay', { method: 'POST', body: JSON.stringify({ transaction: base64 }) })).signature
