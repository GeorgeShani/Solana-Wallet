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
      // a form upload sets its own content type (with the multipart boundary)
      headers: init?.body instanceof FormData ? init.headers : { 'content-type': 'application/json', ...init?.headers },
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

export interface AnnouncementItem {
  id: number
  signature: string
  blockTime: number | null
  /** The sender's ephemeral public key (base58 of 32 bytes). */
  ephemeral: string
  /** The one-time address that was paid. */
  stealth: string
  viewTag: number
}

/** The public feed of stealth-payment announcements (everyone downloads the same feed). */
export const getAnnouncements = (after: number, limit = 1000) =>
  request<{ items: AnnouncementItem[]; latestId: number }>(`/announcements?after=${after}&limit=${limit}`)

export interface NftUpload {
  id: string
  /** The link that goes on-chain: it returns the NFT's name, description and picture. */
  metadataUrl: string
  imageUrl: string
}

/** Stores an NFT's picture and description on the server. The wallet then mints with the returned link. */
export function uploadNft(input: { image: File; name: string; description: string }) {
  const form = new FormData()
  form.set('image', input.image)
  form.set('name', input.name)
  form.set('description', input.description)
  return request<NftUpload>('/nft', { method: 'POST', body: form })
}
