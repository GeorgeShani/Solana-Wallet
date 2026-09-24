import { describe, expect, test } from 'bun:test'
import { ed25519 } from '@noble/curves/ed25519.js'
import {
  createStealthPayment,
  decodeMetaAddress,
  encodeMetaAddress,
  publicKeyFromScalar,
  publicKeyToAddress,
  scalarFromSeed,
  scanAnnouncement,
  signWithScalar,
  stealthKeysFromSeeds,
} from './stealth'

const seed = () => crypto.getRandomValues(new Uint8Array(32))
const newKeys = () => stealthKeysFromSeeds(seed(), seed())
const metaOf = (k: ReturnType<typeof newKeys>) => decodeMetaAddress(encodeMetaAddress(k.spendPub, k.scanPub))
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')
const msg = new TextEncoder().encode('a transaction message')

describe('keys', () => {
  test('a seed yields the same public key as a standard Ed25519 wallet (so it matches the WDK account)', () => {
    for (let i = 0; i < 10; i++) {
      const s = seed()
      expect(hex(publicKeyFromScalar(scalarFromSeed(s)))).toBe(hex(ed25519.getPublicKey(s)))
    }
  })

  test('rejects seeds of the wrong size', () => {
    expect(() => scalarFromSeed(new Uint8Array(31))).toThrow()
  })
})

describe('meta-address', () => {
  test('round-trips', () => {
    const k = newKeys()
    const text = encodeMetaAddress(k.spendPub, k.scanPub)
    expect(text.startsWith('stealth:')).toBe(true)
    const m = decodeMetaAddress(text)
    expect([hex(m.spendPub), hex(m.scanPub)]).toEqual([hex(k.spendPub), hex(k.scanPub)])
    expect(decodeMetaAddress(`  ${text}\n`).spendPub).toEqual(m.spendPub) // tolerates whitespace
  })

  test('rejects things that are not meta-addresses', () => {
    const k = newKeys()
    const good = encodeMetaAddress(k.spendPub, k.scanPub)
    expect(() => decodeMetaAddress('5PgQWusbALXk1PcrPC1BVuXV87R25Rhryu9HsmJvipP4')).toThrow(/starts with/) // a plain address
    expect(() => decodeMetaAddress('stealth:0OIl')).toThrow(/characters/)
    expect(() => decodeMetaAddress(good.slice(0, -4))).toThrow(/length/)
    // the all-zero point decodes as a curve point but has small order: never a real key
    expect(() => decodeMetaAddress('stealth:' + '1'.repeat(64))).toThrow(/not a real key/)
    // a valid spend key paired with a small-order scan key is refused too
    const evil = encodeMetaAddress(k.spendPub, new Uint8Array(32))
    expect(() => decodeMetaAddress(evil)).toThrow(/not a real key/)
    expect(() => decodeMetaAddress('')).toThrow()
  })
})

describe('paying and finding a stealth payment', () => {
  test('the recipient finds the payment and gets the private key of the one-time address', () => {
    const k = newKeys()
    const pay = createStealthPayment(metaOf(k))
    const found = scanAnnouncement(k, { ephemeral: pay.ephemeral, stealthPub: pay.stealthPub, viewTag: pay.viewTag })
    expect(found).not.toBeNull()
    // the recovered scalar really controls the paid address
    expect(hex(publicKeyFromScalar(found!.privateScalar))).toBe(hex(pay.stealthPub))
  })

  test('the funds can be spent: a signature from the recovered key verifies with a standard Ed25519 verifier', () => {
    const k = newKeys()
    const pay = createStealthPayment(metaOf(k))
    const { privateScalar } = scanAnnouncement(k, { ...pay })!
    const sig = signWithScalar(privateScalar, msg)
    expect(sig).toHaveLength(64)
    expect(ed25519.verify(sig, msg, pay.stealthPub)).toBe(true)
    // ...and only for that message and that address
    expect(ed25519.verify(sig, new TextEncoder().encode('another message'), pay.stealthPub)).toBe(false)
    expect(ed25519.verify(sig, msg, k.spendPub)).toBe(false)
  })

  test('signWithScalar agrees with a normal seed-based signer on the same key', () => {
    const s = seed()
    const sig = signWithScalar(scalarFromSeed(s), msg)
    expect(ed25519.verify(sig, msg, ed25519.getPublicKey(s))).toBe(true)
  })

  test('signing is deterministic per message and differs across messages', () => {
    const k = newKeys()
    const a = signWithScalar(k.spend, msg)
    expect(hex(signWithScalar(k.spend, msg))).toBe(hex(a))
    expect(hex(signWithScalar(k.spend, new Uint8Array([1, 2, 3])))).not.toBe(hex(a))
  })

  test('every payment goes to a different address, unrelated to the published keys', () => {
    const k = newKeys()
    const meta = metaOf(k)
    const addrs = Array.from({ length: 20 }, () => hex(createStealthPayment(meta).stealthPub))
    expect(new Set(addrs).size).toBe(20)
    expect(addrs).not.toContain(hex(k.spendPub))
    expect(addrs).not.toContain(hex(k.scanPub))
  })

  test('the same randomness gives the same payment (the API is deterministic when told to be)', () => {
    const meta = metaOf(newKeys())
    const r = seed()
    const [a, b] = [createStealthPayment(meta, r), createStealthPayment(meta, r)]
    expect([hex(a.ephemeral), hex(a.stealthPub), a.viewTag]).toEqual([hex(b.ephemeral), hex(b.stealthPub), b.viewTag])
  })

  test('other people do not find the payment', () => {
    const [alice, bob] = [newKeys(), newKeys()]
    const pay = createStealthPayment(metaOf(alice))
    expect(scanAnnouncement(bob, { ...pay })).toBeNull()
  })

  test('holding only the scan key is not enough to spend', () => {
    const alice = newKeys()
    const pay = createStealthPayment(metaOf(alice))
    // an attacker with the view key but a wrong spend key computes a different address
    const attacker = { ...alice, spend: newKeys().spend }
    attacker.spendPub = publicKeyFromScalar(attacker.spend)
    expect(scanAnnouncement(attacker, { ...pay })).toBeNull()
  })

  test('a tampered or spoofed announcement is rejected', () => {
    const k = newKeys()
    const pay = createStealthPayment(metaOf(k))
    const ann = { ephemeral: pay.ephemeral, stealthPub: pay.stealthPub, viewTag: pay.viewTag }
    expect(scanAnnouncement(k, { ...ann, stealthPub: createStealthPayment(metaOf(k)).stealthPub })).toBeNull() // wrong address
    expect(scanAnnouncement(k, { ...ann, viewTag: (ann.viewTag + 1) % 256 })).toBeNull() // wrong tag
    expect(scanAnnouncement(k, { ...ann, ephemeral: new Uint8Array(32).fill(0xff) })).toBeNull() // not a point
    expect(scanAnnouncement(k, { ...ann, ephemeral: new Uint8Array(32) })).toBeNull() // small-order point
    expect(scanAnnouncement(k, { ...ann, ephemeral: createStealthPayment(metaOf(k)).ephemeral })).toBeNull() // R from another payment
  })

  test('a scanning wallet finds its own payments among many others', () => {
    const [mine, others] = [newKeys(), newKeys()]
    const feed = [] as { pay: ReturnType<typeof createStealthPayment>; own: boolean }[]
    for (let i = 0; i < 60; i++) {
      const own = i % 6 === 0
      feed.push({ pay: createStealthPayment(metaOf(own ? mine : others)), own })
    }
    const found = feed.filter((f) => scanAnnouncement(mine, f.pay))
    expect(found.every((f) => f.own)).toBe(true)
    expect(found).toHaveLength(feed.filter((f) => f.own).length)
  })

  test('addresses are valid base58 Solana addresses', () => {
    const pay = createStealthPayment(metaOf(newKeys()))
    const addr = publicKeyToAddress(pay.stealthPub)
    expect(addr.length).toBeGreaterThanOrEqual(32)
    expect(addr.length).toBeLessThanOrEqual(44)
  })
})
