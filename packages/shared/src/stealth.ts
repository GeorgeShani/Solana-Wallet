// Stealth addresses on Ed25519 (Solana's curve).
//
// The recipient publishes ONE "meta-address" made of two public keys:
//     S = s·G   (spend key)      V = v·G   (scan/view key)
// To pay them, a sender picks a fresh random r and computes
//     R = r·G                    (ephemeral key, announced publicly)
//     h = H(r·V)                 (shared secret; the recipient gets the same value as v·R)
//     P = S + h·G                (a one-time address nobody can link to S or V)
// and pays P. The recipient scans announcements: for each R they compute h = H(v·R) and check
// whether S + h·G is the announced address. If so, P's private key is p = s + h (mod L),
// because P = (s + h)·G. Only someone holding s can spend from P; someone holding only v can
// see which payments are theirs but cannot move them.
//
// Nothing here is a new primitive: it is the "dual-key stealth address protocol" used by
// Monero and Ethereum's ERC-5564, adapted to Ed25519. It is not audited.

import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import { base58 } from '@scure/base'

const Point = ed25519.Point
/** The order of the Ed25519 group: scalars live modulo this. */
const L = Point.Fn.ORDER
const G = Point.BASE
const te = new TextEncoder()

const DOMAIN_SHARED = te.encode('wallet/stealth/v1/shared')
const DOMAIN_TAG = te.encode('wallet/stealth/v1/tag')
const DOMAIN_NONCE = te.encode('wallet/stealth/v1/nonce')
export const META_ADDRESS_PREFIX = 'stealth:'

const mod = (a: bigint) => ((a % L) + L) % L

function bytesToNumberLE(bytes: Uint8Array): bigint {
  let n = 0n
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i])
  return n
}

function numberToBytes32LE(n: bigint): Uint8Array {
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    out[i] = Number(n & 0xffn)
    n >>= 8n
  }
  return out
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) (out.set(p, o), (o += p.length))
  return out
}

const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

/** The secret scalar of an Ed25519 seed (what its public key is a multiple of). */
export function scalarFromSeed(seed: Uint8Array): bigint {
  if (seed.length !== 32) throw new Error('An Ed25519 seed is 32 bytes')
  const head = sha512(seed).slice(0, 32)
  head[0] &= 248
  head[31] &= 127
  head[31] |= 64
  return mod(bytesToNumberLE(head))
}

export interface StealthKeys {
  spend: bigint
  scan: bigint
  spendPub: Uint8Array
  scanPub: Uint8Array
}

/** Build a wallet's stealth keys from two Ed25519 seeds (WDK derives them at dedicated paths). */
export function stealthKeysFromSeeds(spendSeed: Uint8Array, scanSeed: Uint8Array): StealthKeys {
  const spend = scalarFromSeed(spendSeed)
  const scan = scalarFromSeed(scanSeed)
  return { spend, scan, spendPub: G.multiply(spend).toBytes(), scanPub: G.multiply(scan).toBytes() }
}

// ------------------------------------------------------------------ meta-address

/**
 * A real public key: a valid curve point of the prime-order subgroup and not the identity. Points
 * of small order (such as the all-zero key) decode fine but are never anyone's genuine key, and
 * an address built on one would not be controlled the way the sender expects.
 */
function isSafePublicKey(bytes: Uint8Array): boolean {
  try {
    const p = Point.fromBytes(bytes)
    return !p.isSmallOrder() && p.isTorsionFree()
  } catch {
    return false
  }
}

/** `stealth:<base58(S ‖ V)>`: the one string a recipient shares. */
export function encodeMetaAddress(spendPub: Uint8Array, scanPub: Uint8Array): string {
  return META_ADDRESS_PREFIX + base58.encode(concat(spendPub, scanPub))
}

export interface MetaAddress {
  spendPub: Uint8Array
  scanPub: Uint8Array
}

/** Parses and validates a meta-address. Throws a readable error if it isn't one. */
export function decodeMetaAddress(text: string): MetaAddress {
  const t = text.trim()
  if (!t.startsWith(META_ADDRESS_PREFIX)) throw new Error(`A stealth address starts with "${META_ADDRESS_PREFIX}"`)
  let bytes: Uint8Array
  try {
    bytes = base58.decode(t.slice(META_ADDRESS_PREFIX.length))
  } catch {
    throw new Error('That stealth address is not valid (bad characters)')
  }
  if (bytes.length !== 64) throw new Error('That stealth address is not valid (wrong length)')
  const [spendPub, scanPub] = [bytes.slice(0, 32), bytes.slice(32)]
  if (!isSafePublicKey(spendPub) || !isSafePublicKey(scanPub)) {
    throw new Error('That stealth address is not valid (not a real key)')
  }
  return { spendPub, scanPub }
}

// ------------------------------------------------------------------ paying

export interface StealthPayment {
  /** R: publish this alongside the payment. */
  ephemeral: Uint8Array
  /** P: the one-time address to pay. */
  stealthPub: Uint8Array
  /** Lets the recipient discard most announcements cheaply. */
  viewTag: number
}

/** The hash of the shared secret, as a scalar, plus the 1-byte view tag. */
function derive(shared: Uint8Array): { h: bigint; viewTag: number } {
  const h = mod(bytesToNumberLE(sha512(concat(DOMAIN_SHARED, shared))))
  if (h === 0n) throw new Error('Degenerate shared secret')
  return { h, viewTag: sha256(concat(DOMAIN_TAG, shared))[0] }
}

/**
 * Derive a fresh one-time address for `meta`. `randomness` is 32 random bytes; it is a parameter
 * only so tests can be deterministic. Callers should leave it out.
 */
export function createStealthPayment(
  meta: MetaAddress,
  randomness: Uint8Array = crypto.getRandomValues(new Uint8Array(32)),
): StealthPayment {
  const r = mod(bytesToNumberLE(sha512(randomness))) // uniform in [0, L)
  if (r === 0n) throw new Error('Degenerate randomness')
  const spend = Point.fromBytes(meta.spendPub)
  const scan = Point.fromBytes(meta.scanPub)
  const { h, viewTag } = derive(scan.multiply(r).toBytes())
  return {
    ephemeral: G.multiply(r).toBytes(),
    stealthPub: spend.add(G.multiply(h)).toBytes(),
    viewTag,
  }
}

// ------------------------------------------------------------------ receiving

export interface Announcement {
  ephemeral: Uint8Array
  stealthPub: Uint8Array
  viewTag: number
}

/**
 * Is this announcement a payment to me? Returns the private scalar of the one-time address if so,
 * or null. Cheap checks come first, so scanning thousands of announcements is fast.
 */
export function scanAnnouncement(keys: StealthKeys, a: Announcement): { privateScalar: bigint } | null {
  let shared: Uint8Array
  try {
    const ephemeral = Point.fromBytes(a.ephemeral)
    if (ephemeral.isSmallOrder()) return null // never produced by an honest sender
    shared = ephemeral.multiply(keys.scan).toBytes()
  } catch {
    return null // not a valid point: not ours
  }
  const { h, viewTag } = derive(shared)
  if (viewTag !== a.viewTag) return null
  const expected = Point.fromBytes(keys.spendPub).add(G.multiply(h)).toBytes()
  if (!equalBytes(expected, a.stealthPub)) return null
  return { privateScalar: mod(keys.spend + h) }
}

// ------------------------------------------------------------------ spending

/** The public key (address) belonging to a stealth private scalar. */
export function publicKeyFromScalar(scalar: bigint): Uint8Array {
  return G.multiply(mod(scalar)).toBytes()
}

/**
 * An ordinary Ed25519 signature made with a raw secret scalar. A stealth key has no 32-byte seed
 * to feed a normal signer, but Ed25519 signing only needs the scalar and a secret nonce. The nonce
 * here is derived from the scalar and the message, like RFC 8032 derives it from its prefix. The
 * result verifies with any standard Ed25519 verifier (including Solana's).
 */
export function signWithScalar(scalar: bigint, message: Uint8Array): Uint8Array {
  const a = mod(scalar)
  const pub = G.multiply(a).toBytes()
  const r = mod(bytesToNumberLE(sha512(concat(DOMAIN_NONCE, numberToBytes32LE(a), message))))
  const R = G.multiply(r === 0n ? 1n : r).toBytes()
  const k = mod(bytesToNumberLE(sha512(concat(R, pub, message))))
  const s = mod((r === 0n ? 1n : r) + k * a)
  return concat(R, numberToBytes32LE(s))
}

/** Base58 form of a 32-byte public key: a Solana address. */
export const publicKeyToAddress = (pub: Uint8Array) => base58.encode(pub)
export const addressToPublicKey = (addr: string) => base58.decode(addr)
