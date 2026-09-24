// Password-based encryption of the seed phrase: PBKDF2-SHA256 -> AES-256-GCM.
// Pure WebCrypto so it can be unit-tested under bun without a browser.

export interface EncryptedVault {
  v: 1
  iterations: number
  salt: string
  iv: string
  ct: string
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong password')
    this.name = 'WrongPasswordError'
  }
}

export const DEFAULT_ITERATIONS = 600_000

const enc = new TextEncoder()
const dec = new TextDecoder()

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptSeed(
  seed: string,
  password: string,
  iterations = DEFAULT_ITERATIONS,
): Promise<EncryptedVault> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, iterations)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(seed)))
  return { v: 1, iterations, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) }
}

export async function decryptSeed(vault: EncryptedVault, password: string): Promise<string> {
  const key = await deriveKey(password, fromB64(vault.salt), vault.iterations)
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(vault.iv) as BufferSource },
      key,
      fromB64(vault.ct) as BufferSource,
    )
    return dec.decode(pt)
  } catch {
    // AES-GCM auth failure means wrong password (or a tampered vault)
    throw new WrongPasswordError()
  }
}
