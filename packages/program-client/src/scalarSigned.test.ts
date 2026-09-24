import { describe, expect, test } from 'bun:test'
import { ed25519 } from '@noble/curves/ed25519.js'
import { address } from '@solana/addresses'
import type { Blockhash } from '@solana/rpc-types'
import { getTransactionDecoder } from '@solana/transactions'
import {
  addressToPublicKey,
  createStealthPayment,
  decodeMetaAddress,
  encodeMetaAddress,
  publicKeyToAddress,
  scanAnnouncement,
  stealthKeysFromSeeds,
} from '@wallet/shared'
import { buildScalarSignedTransaction, systemTransfer, syncNative } from './index'

const blockhash = { blockhash: '11111111111111111111111111111111' as Blockhash, lastValidBlockHeight: 1n }
const seed = () => crypto.getRandomValues(new Uint8Array(32))

/** A stealth address the way a recipient would find it: pay -> scan -> private scalar. */
function foundStealthAddress() {
  const keys = stealthKeysFromSeeds(seed(), seed())
  const pay = createStealthPayment(decodeMetaAddress(encodeMetaAddress(keys.spendPub, keys.scanPub)))
  const { privateScalar } = scanAnnouncement(keys, pay)!
  return { scalar: privateScalar, pub: pay.stealthPub, address: address(publicKeyToAddress(pay.stealthPub)) }
}

describe('transactions signed by a stealth address', () => {
  test("the signature verifies against the stealth address over the transaction's message bytes", () => {
    const s = foundStealthAddress()
    const dest = address('5PgQWusbALXk1PcrPC1BVuXV87R25Rhryu9HsmJvipP4')
    const b64 = buildScalarSignedTransaction({
      feePayer: s.address,
      scalar: s.scalar,
      instructions: [systemTransfer({ from: s.address, to: dest, lamports: 1_000_000n })],
      blockhash,
    })
    const tx = getTransactionDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
    expect(Object.keys(tx.signatures)).toEqual([s.address])
    const sig = tx.signatures[s.address]!
    // exactly what a Solana validator checks
    expect(ed25519.verify(sig, tx.messageBytes, addressToPublicKey(s.address))).toBe(true)
    // ...and it would not verify for a different message
    expect(ed25519.verify(sig, new Uint8Array(tx.messageBytes).reverse(), addressToPublicKey(s.address))).toBe(false)
  })

  test('refuses a transaction that would need another signer', () => {
    const s = foundStealthAddress()
    const other = address('5PgQWusbALXk1PcrPC1BVuXV87R25Rhryu9HsmJvipP4')
    expect(() =>
      buildScalarSignedTransaction({
        feePayer: s.address,
        scalar: s.scalar,
        // `other` must sign this transfer, but we can only sign as the stealth address
        instructions: [systemTransfer({ from: other, to: s.address, lamports: 1n })],
        blockhash,
      }),
    ).toThrow(/only have the stealth address/)
  })

  test('the stealth address may act as authority on several instructions', () => {
    const s = foundStealthAddress()
    const wsolAta = address('141GfzLBSYp2qBEtqdBfJ9P3FGK99twsu6NLaE8y5z2i')
    const b64 = buildScalarSignedTransaction({
      feePayer: s.address,
      scalar: s.scalar,
      instructions: [systemTransfer({ from: s.address, to: wsolAta, lamports: 5n }), syncNative(wsolAta)],
      blockhash,
    })
    expect(b64.length).toBeGreaterThan(100)
  })
})
