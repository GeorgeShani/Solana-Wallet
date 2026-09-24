import { describe, expect, test } from 'bun:test'
import { address, getAddressEncoder } from '@solana/addresses'
import { AccountRole } from '@solana/instructions'
import { instructionDiscriminator, parseAnnouncements } from '@wallet/program-client'
import {
  decodeMetaAddress,
  encodeMetaAddress,
  publicKeyToAddress,
  scanAnnouncement,
  addressToPublicKey,
  stealthKeysFromSeeds,
} from '@wallet/shared'
import type { AnnouncementItem } from '../api'
import { FEE_MARGIN_LAMPORTS, planStealthPayment } from './pay'
import { findMyPayments } from './scan'
import { planSweep, SWEEP_FEE_LAMPORTS } from './spend'

const seed = () => crypto.getRandomValues(new Uint8Array(32))
const newWallet = () => {
  const keys = stealthKeysFromSeeds(seed(), seed())
  return { keys, meta: decodeMetaAddress(encodeMetaAddress(keys.spendPub, keys.scanPub)) }
}
const SENDER = '5PgQWusbALXk1PcrPC1BVuXV87R25Rhryu9HsmJvipP4'
const MINT = '19wY9kjM8ijyUhjhT2vRBkcpBsXLG8HRMvrNXXQEkdB'
const RENT = 1_488_440n
const enc = getAddressEncoder()
/** A valid (random) address, for places where the value does not matter. */
const randomAddress = () => publicKeyToAddress(seed())

/** What the indexer would serve for the `announce` instruction in a plan. */
function announcementOf(instructions: { programAddress: string; data?: Uint8Array | readonly number[] }[], id = 1): AnnouncementItem {
  const ix = instructions[instructions.length - 1]
  const data = Uint8Array.from(ix.data!)
  expect(Array.from(data.slice(0, 8))).toEqual(Array.from(instructionDiscriminator('announce')))
  return {
    id,
    signature: `sig${id}`,
    blockTime: 1000 + id,
    ephemeral: publicKeyToAddress(data.slice(8, 40)),
    stealth: publicKeyToAddress(data.slice(40, 72)),
    viewTag: data[72],
  }
}

describe('paying a stealth address', () => {
  test('a SOL payment is a transfer to a fresh one-time address plus an announcement the recipient can find', async () => {
    const bob = newWallet()
    const plan = await planStealthPayment({ sender: SENDER, meta: bob.meta, mint: null, decimals: 9, amount: 10_000_000n, tokenAccountRent: RENT })
    expect(plan.instructions).toHaveLength(2)
    const [transfer, announce] = plan.instructions
    expect(transfer.accounts![1].address).toBe(plan.stealthAddress) // pays the one-time address, not Bob's published keys
    expect(plan.stealthAddress).not.toBe(publicKeyToAddress(bob.keys.spendPub))
    expect(announce.accounts).toEqual([{ address: SENDER, role: AccountRole.READONLY_SIGNER }])

    // Bob's wallet finds it and recovers the key to that very address
    const found = findMyPayments(bob.keys, [announcementOf(plan.instructions)])
    expect(found).toHaveLength(1)
    expect(found[0].address).toBe(plan.stealthAddress)
  })

  test('a token payment also opens the address’s token account and sends a little SOL for its fees', async () => {
    const bob = newWallet()
    const plan = await planStealthPayment({ sender: SENDER, meta: bob.meta, mint: MINT, decimals: 6, amount: 5_000_000n, tokenAccountRent: RENT })
    expect(plan.instructions).toHaveLength(4) // gas, create token account, transfer, announce
    const gas = plan.instructions[0]
    // system transfer of rent + margin: lamports are the last 8 bytes, little-endian
    const lamports = new DataView(Uint8Array.from(gas.data!).buffer).getBigUint64(4, true)
    expect(lamports).toBe(RENT + FEE_MARGIN_LAMPORTS)
    expect(gas.accounts![1].address).toBe(plan.stealthAddress)
    expect(findMyPayments(bob.keys, [announcementOf(plan.instructions)])).toHaveLength(1)
  })

  test('the announcement does not include the sender or anything about the recipient', async () => {
    const plan = await planStealthPayment({ sender: SENDER, meta: newWallet().meta, mint: null, decimals: 9, amount: 1n, tokenAccountRent: RENT })
    const data = Uint8Array.from(plan.instructions[1].data!)
    expect(data.length).toBe(8 + 32 + 32 + 1)
    const senderBytes = Array.from(enc.encode(address(SENDER)))
    expect(Array.from(data).join(',').includes(senderBytes.join(','))).toBe(false)
  })

  test('the indexer-side log parser reads back exactly what the plan announced', async () => {
    const bob = newWallet()
    const plan = await planStealthPayment({ sender: SENDER, meta: bob.meta, mint: null, decimals: 9, amount: 1n, tokenAccountRent: RENT })
    const a = announcementOf(plan.instructions)
    // the program would log the event as: discriminator ‖ R ‖ P ‖ tag
    const { default: idl } = await import('../../../anchor/idl/wallet_program.json')
    const disc = idl.events.find((e) => e.name === 'StealthAnnouncement')!.discriminator
    const line = 'Program data: ' + btoa(String.fromCharCode(...disc, ...addressToPublicKey(a.ephemeral), ...addressToPublicKey(a.stealth), a.viewTag))
    const [parsed] = parseAnnouncements([line])
    expect(parsed.stealth).toBe(a.stealth)
    expect(parsed.viewTag).toBe(a.viewTag)
  })
})

describe('scanning the public feed', () => {
  test('finds only my payments among many, and merges duplicates', async () => {
    const [me, other] = [newWallet(), newWallet()]
    const feed: AnnouncementItem[] = []
    for (let i = 0; i < 24; i++) {
      const mine = i % 4 === 0
      const plan = await planStealthPayment({ sender: SENDER, meta: (mine ? me : other).meta, mint: null, decimals: 9, amount: 1n, tokenAccountRent: RENT })
      feed.push(announcementOf(plan.instructions, i + 1))
    }
    feed.push({ ...feed[0], id: 99 }) // the same payment announced twice
    const found = findMyPayments(me.keys, feed)
    expect(found).toHaveLength(6)
    expect(new Set(found.map((f) => f.address)).size).toBe(6)
  })

  test('ignores malformed or spoofed entries', () => {
    const me = newWallet()
    const junk: AnnouncementItem[] = [
      { id: 1, signature: 's', blockTime: null, ephemeral: 'not-an-address', stealth: 'nope', viewTag: 1 },
      { id: 2, signature: 's', blockTime: null, ephemeral: '11111111111111111111111111111111', stealth: '11111111111111111111111111111111', viewTag: 0 },
    ]
    expect(findMyPayments(me.keys, junk)).toEqual([])
  })

  test('the recovered key is what the wallet needs to spend', async () => {
    const me = newWallet()
    const plan = await planStealthPayment({ sender: SENDER, meta: me.meta, mint: null, decimals: 9, amount: 1n, tokenAccountRent: RENT })
    const a = announcementOf(plan.instructions)
    const hit = scanAnnouncement(me.keys, { ephemeral: addressToPublicKey(a.ephemeral), stealthPub: addressToPublicKey(a.stealth), viewTag: a.viewTag })
    expect(hit).not.toBeNull()
  })
})

describe('sweeping a one-time address', () => {
  const from = '9LocV1FP6dDVjsmkncsW54oWg9MF3NZAjMgjPkcqrNb7'
  const dest = '141GfzLBSYp2qBEtqdBfJ9P3FGK99twsu6NLaE8y5z2i'
  const base = {
    from,
    destination: dest,
    destinationHasToken: new Map<string, boolean>(),
    destinationSolBalance: 100_000_000n,
    ata: (() => {
      const cache = new Map<string, string>()
      return (owner: string, mint: string) => {
        const key = `${owner}:${mint}`
        if (!cache.has(key)) cache.set(key, randomAddress())
        return cache.get(key)!
      }
    })(),
    tokenAccountRent: RENT,
    minSystemBalance: 650_240n,
  }
  const holding = (amount: bigint, mint = MINT) => ({ mint, amount, decimals: 6, tokenAccount: randomAddress() })

  test('SOL only: everything except the fee arrives, leaving the address at exactly zero', () => {
    const plan = planSweep({ ...base, solBalance: 10_000_000n, tokens: [] })
    expect(plan.solOut).toBe(10_000_000n - SWEEP_FEE_LAMPORTS)
    expect(plan.instructions).toHaveLength(1)
  })

  test('tokens: opens the destination account, moves the tokens, closes the source, then sends the leftover SOL', () => {
    const solBalance = RENT + FEE_MARGIN_LAMPORTS // what a token payment leaves behind
    const plan = planSweep({ ...base, solBalance, tokens: [holding(5_000_000n)] })
    expect(plan.instructions).toHaveLength(4) // create dest ATA, transfer, close, then the leftover SOL
    // exactly: balance − fee − new destination account = margin − fee
    expect(plan.solOut).toBe(FEE_MARGIN_LAMPORTS - SWEEP_FEE_LAMPORTS)
  })

  test('if the destination already has the token account nothing extra is spent on it', () => {
    const plan = planSweep({ ...base, solBalance: 3_000_000n, tokens: [holding(1n)], destinationHasToken: new Map([[MINT, true]]) })
    expect(plan.solOut).toBe(3_000_000n - SWEEP_FEE_LAMPORTS)
  })

  test('refuses when the address can not pay the fee, has nothing, or would strand dust', () => {
    expect(() => planSweep({ ...base, solBalance: 1_000n, tokens: [holding(1n)] })).toThrow(/enough SOL/)
    expect(() => planSweep({ ...base, solBalance: SWEEP_FEE_LAMPORTS, tokens: [] })).toThrow(/nothing to withdraw/)
    expect(() => planSweep({ ...base, solBalance: 100_000n, tokens: [], destinationSolBalance: 0n })).toThrow(/too small/)
    const many = [1, 2, 3, 4].map(() => holding(1n, randomAddress()))
    expect(() => planSweep({ ...base, solBalance: 10_000_000n, tokens: many })).toThrow(/smaller steps/)
  })

  test('the address is the only signer and pays for everything itself', () => {
    const plan = planSweep({ ...base, solBalance: 5_000_000n, tokens: [holding(9n)] })
    const signers = new Set<string>()
    for (const ix of plan.instructions) for (const a of ix.accounts ?? []) if (a.role >= AccountRole.READONLY_SIGNER) signers.add(a.address)
    expect([...signers]).toEqual([from])
  })
})
