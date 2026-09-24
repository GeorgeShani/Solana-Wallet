import { describe, expect, test } from 'bun:test'
import { address, getAddressEncoder } from '@solana/addresses'
import { AccountRole } from '@solana/instructions'
import idl from '../../../anchor/idl/wallet_program.json'
import {
  announceInstruction,
  cancelTimelockInstruction,
  createTimelockInstruction,
  decodeTimelock,
  deriveTimelockAddresses,
  findAssociatedTokenAddress,
  i64,
  instructionDiscriminator,
  parseAnnouncements,
  TIMELOCK_DISCRIMINATOR,
  TIMELOCK_SIZE,
  transferChecked,
  u64,
  withdrawTimelockInstruction,
} from './index'

const SENDER = address('5PgQWusbALXk1PcrPC1BVuXV87R25Rhryu9HsmJvipP4')
const RECIPIENT = address('141GfzLBSYp2qBEtqdBfJ9P3FGK99twsu6NLaE8y5z2i')
const MINT = address('19wY9kjM8ijyUhjhT2vRBkcpBsXLG8HRMvrNXXQEkdB')
const enc = getAddressEncoder()

describe('timelock client', () => {
  test('the timelock address depends on sender, recipient and seed', async () => {
    const a = await deriveTimelockAddresses(SENDER, RECIPIENT, 1n, MINT)
    expect((await deriveTimelockAddresses(SENDER, RECIPIENT, 1n, MINT)).timelock).toBe(a.timelock)
    expect((await deriveTimelockAddresses(SENDER, RECIPIENT, 2n, MINT)).timelock).not.toBe(a.timelock)
    expect((await deriveTimelockAddresses(RECIPIENT, SENDER, 1n, MINT)).timelock).not.toBe(a.timelock)
    expect(a.vault).toBe(await findAssociatedTokenAddress(a.timelock, MINT))
  })

  test('create_timelock: accounts, roles and borsh data', async () => {
    const { timelock, vault } = await deriveTimelockAddresses(SENDER, RECIPIENT, 7n, MINT)
    const senderToken = await findAssociatedTokenAddress(SENDER, MINT)
    const ix = createTimelockInstruction({
      sender: SENDER, recipient: RECIPIENT, mint: MINT, timelock, vault, senderToken,
      seed: 7n, amount: 1_000n, start: 100n, cliff: 200n, end: 300n, cancellable: true,
    })
    expect(ix.accounts).toHaveLength(9)
    expect(ix.accounts!.slice(0, 6).map((a) => a.address)).toEqual([SENDER, RECIPIENT, MINT, timelock, vault, senderToken])
    expect(ix.accounts![0].role).toBe(AccountRole.WRITABLE_SIGNER)
    expect(ix.accounts![1].role).toBe(AccountRole.READONLY) // the recipient does not sign a lock
    expect(Array.from(ix.data!)).toEqual([
      ...instructionDiscriminator('create_timelock'),
      ...u64(7n), ...u64(1_000n), ...i64(100n), ...i64(200n), ...i64(300n), 1,
    ])
  })

  test('withdraw is signed by the recipient; cancel by the sender', async () => {
    const { timelock, vault } = await deriveTimelockAddresses(SENDER, RECIPIENT, 1n, MINT)
    const recipientToken = await findAssociatedTokenAddress(RECIPIENT, MINT)
    const senderToken = await findAssociatedTokenAddress(SENDER, MINT)
    const w = withdrawTimelockInstruction({ recipient: RECIPIENT, timelock, sender: SENDER, mint: MINT, vault, recipientToken })
    expect(w.accounts![0]).toEqual({ address: RECIPIENT, role: AccountRole.READONLY_SIGNER })
    expect(Array.from(w.data!)).toEqual(Array.from(instructionDiscriminator('withdraw_timelock')))
    const c = cancelTimelockInstruction({ sender: SENDER, timelock, mint: MINT, vault, senderToken })
    expect(c.accounts![0]).toEqual({ address: SENDER, role: AccountRole.WRITABLE_SIGNER })
    expect(c.accounts).toHaveLength(6)
  })

  test('decodeTimelock reads a serialized Timelock', () => {
    const d = new Uint8Array(TIMELOCK_SIZE)
    d.set(TIMELOCK_DISCRIMINATOR, 0)
    d.set(enc.encode(SENDER), 8)
    d.set(enc.encode(RECIPIENT), 40)
    d.set(enc.encode(MINT), 72)
    d.set(u64(7n), 104) // seed
    d.set(u64(1_000n), 112) // total
    d.set(u64(250n), 120) // withdrawn
    d.set(i64(100n), 128) // start
    d.set(i64(200n), 136) // cliff
    d.set(i64(300n), 144) // end
    d[152] = 254 // bump
    d[153] = 1 // cancellable
    expect(decodeTimelock(d)).toEqual({
      sender: SENDER, recipient: RECIPIENT, mint: MINT, seed: 7n, total: 1_000n, withdrawn: 250n,
      start: 100n, cliff: 200n, end: 300n, cancellable: true,
    })
    d[153] = 0
    expect(decodeTimelock(d).cancellable).toBe(false)
    expect(() => decodeTimelock(new Uint8Array(TIMELOCK_SIZE))).toThrow() // wrong discriminator
    expect(() => decodeTimelock(d.subarray(0, 50))).toThrow() // truncated
  })

  test('transferChecked encodes amount and decimals', () => {
    const ix = transferChecked({ source: SENDER, mint: MINT, destination: RECIPIENT, authority: SENDER, amount: 5n, decimals: 6 })
    expect(Array.from(ix.data!)).toEqual([12, ...u64(5n), 6])
    expect(ix.accounts![3].role).toBe(AccountRole.READONLY_SIGNER)
  })
})

describe('stealth announcements', () => {
  const ephemeral = address('9LocV1FP6dDVjsmkncsW54oWg9MF3NZAjMgjPkcqrNb7')
  const stealth = address('AemZnQTryaitgRVuvRzaBU7uUzg1hXtu2zkkARbUzRsV')

  test('announce carries the ephemeral key, stealth address and tag, and only needs a fee payer', () => {
    const ix = announceInstruction({ payer: SENDER, ephemeral, stealth, viewTag: 0xab })
    expect(ix.accounts).toEqual([{ address: SENDER, role: AccountRole.READONLY_SIGNER }])
    expect(Array.from(ix.data!)).toEqual([
      ...instructionDiscriminator('announce'),
      ...enc.encode(ephemeral), ...enc.encode(stealth), 0xab,
    ])
  })

  /** What the program logs for `emit!(StealthAnnouncement { .. })`. */
  const eventLine = (disc: number[], eph: Uint8Array, st: Uint8Array, tag: number) =>
    'Program data: ' + btoa(String.fromCharCode(...disc, ...eph, ...st, tag))

  // The event discriminator from the IDL (also asserted by the Rust integration test)
  const DISC = idl.events.find((e) => e.name === 'StealthAnnouncement')!.discriminator

  test('parseAnnouncements finds events in transaction logs and ignores everything else', () => {
    const logs = [
      'Program 6rAZLb32wv86p3uhqQQCZpDxn4BYiFBX7tqPvw7HpD27 invoke [1]',
      'Program log: Instruction: Announce',
      eventLine(DISC, enc.encode(ephemeral) as Uint8Array, enc.encode(stealth) as Uint8Array, 200),
      'Program data: not-base64!!!',
      eventLine([1, 2, 3, 4, 5, 6, 7, 8], enc.encode(ephemeral) as Uint8Array, enc.encode(stealth) as Uint8Array, 1), // other event
      'Program data: AAAA', // too short
    ]
    const found = parseAnnouncements(logs)
    expect(found).toHaveLength(1)
    expect(found[0].stealth).toBe(stealth)
    expect(found[0].viewTag).toBe(200)
    expect(Array.from(found[0].ephemeral)).toEqual(Array.from(enc.encode(ephemeral)))
  })

  test('parseAnnouncements returns nothing for logs without events', () => {
    expect(parseAnnouncements([])).toEqual([])
    expect(parseAnnouncements(['Program log: hello'])).toEqual([])
  })
})
