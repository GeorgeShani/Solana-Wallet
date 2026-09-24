import { describe, expect, test } from 'bun:test'
import { decryptSeed, encryptSeed, WrongPasswordError } from './vaultCrypto'

const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const FAST = 1000 // low iteration count keeps tests quick

describe('vaultCrypto', () => {
  test('round-trips a seed phrase', async () => {
    const v = await encryptSeed(SEED, 'hunter2', FAST)
    expect(await decryptSeed(v, 'hunter2')).toBe(SEED)
  })

  test('ciphertext does not contain the plaintext', async () => {
    const v = await encryptSeed(SEED, 'hunter2', FAST)
    expect(JSON.stringify(v)).not.toContain('abandon')
  })

  test('rejects a wrong password', async () => {
    const v = await encryptSeed(SEED, 'hunter2', FAST)
    await expect(decryptSeed(v, 'wrong')).rejects.toBeInstanceOf(WrongPasswordError)
  })

  test('rejects a tampered ciphertext', async () => {
    const v = await encryptSeed(SEED, 'hunter2', FAST)
    const bytes = Uint8Array.from(atob(v.ct), (c) => c.charCodeAt(0))
    bytes[0] ^= 1
    const tampered = { ...v, ct: btoa(String.fromCharCode(...bytes)) }
    await expect(decryptSeed(tampered, 'hunter2')).rejects.toBeInstanceOf(WrongPasswordError)
  })

  test('uses a fresh salt and iv each time', async () => {
    const a = await encryptSeed(SEED, 'pw', FAST)
    const b = await encryptSeed(SEED, 'pw', FAST)
    expect(a.salt).not.toBe(b.salt)
    expect(a.iv).not.toBe(b.iv)
  })
})
