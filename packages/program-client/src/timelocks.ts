import { getProgramDerivedAddress, type Address } from '@solana/addresses'
import type { Instruction } from '@solana/instructions'
import { concat, i64, readI64, readU64, u64 } from './encoding'
import { addressBytes } from './token'
import { addressFromBytes, build, findAssociatedTokenAddress, idl, PROGRAM_ADDRESS } from './core'

// ------------------------------------------------------------------ timelocks

export async function findTimelockAddress(sender: Address, recipient: Address, seed: bigint): Promise<Address> {
  const [timelock] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ADDRESS,
    seeds: ['timelock', addressBytes(sender), addressBytes(recipient), u64(seed)],
  })
  return timelock
}

export interface TimelockAddresses {
  timelock: Address
  /** The escrow token account holding the locked tokens. */
  vault: Address
}

export async function deriveTimelockAddresses(
  sender: Address,
  recipient: Address,
  seed: bigint,
  mint: Address,
): Promise<TimelockAddresses> {
  const timelock = await findTimelockAddress(sender, recipient, seed)
  return { timelock, vault: await findAssociatedTokenAddress(timelock, mint) }
}

export function createTimelockInstruction(input: {
  sender: Address
  recipient: Address
  mint: Address
  timelock: Address
  vault: Address
  senderToken: Address
  seed: bigint
  amount: bigint
  /** Unix seconds. Nothing vests before `cliff`, everything from `end`, linear from `start`. */
  start: bigint
  cliff: bigint
  end: bigint
  cancellable: boolean
}): Instruction {
  return build(
    'create_timelock',
    {
      sender: input.sender,
      recipient: input.recipient,
      mint: input.mint,
      timelock: input.timelock,
      vault: input.vault,
      sender_token: input.senderToken,
    },
    concat(
      u64(input.seed),
      u64(input.amount),
      i64(input.start),
      i64(input.cliff),
      i64(input.end),
      Uint8Array.of(input.cancellable ? 1 : 0),
    ),
  )
}

export function withdrawTimelockInstruction(input: {
  recipient: Address
  timelock: Address
  sender: Address
  mint: Address
  vault: Address
  recipientToken: Address
}): Instruction {
  return build(
    'withdraw_timelock',
    {
      recipient: input.recipient,
      timelock: input.timelock,
      sender: input.sender,
      mint: input.mint,
      vault: input.vault,
      recipient_token: input.recipientToken,
    },
    new Uint8Array(),
  )
}

export function cancelTimelockInstruction(input: {
  sender: Address
  timelock: Address
  mint: Address
  vault: Address
  senderToken: Address
}): Instruction {
  return build(
    'cancel_timelock',
    {
      sender: input.sender,
      timelock: input.timelock,
      mint: input.mint,
      vault: input.vault,
      sender_token: input.senderToken,
    },
    new Uint8Array(),
  )
}

export interface DecodedTimelock {
  sender: Address
  recipient: Address
  mint: Address
  seed: bigint
  total: bigint
  withdrawn: bigint
  start: bigint
  cliff: bigint
  end: bigint
  cancellable: boolean
}

/** Size of a Timelock account: 8-byte discriminator + 3 pubkeys + 3 u64 + 3 i64 + u8 + bool. */
export const TIMELOCK_SIZE = 8 + 32 * 3 + 8 * 3 + 8 * 3 + 1 + 1

export const TIMELOCK_DISCRIMINATOR = Uint8Array.from(idl.accounts.find((a) => a.name === 'Timelock')!.discriminator)

export function decodeTimelock(data: Uint8Array): DecodedTimelock {
  if (data.length < TIMELOCK_SIZE || !TIMELOCK_DISCRIMINATOR.every((b, i) => data[i] === b)) {
    throw new Error('Not a timelock account')
  }
  const addr = (offset: number) => addressFromBytes(data.subarray(offset, offset + 32))
  return {
    sender: addr(8),
    recipient: addr(40),
    mint: addr(72),
    seed: readU64(data, 104),
    total: readU64(data, 112),
    withdrawn: readU64(data, 120),
    start: readI64(data, 128),
    cliff: readI64(data, 136),
    end: readI64(data, 144),
    cancellable: data[153] === 1,
  }
}

// ------------------------------------------------------------------ stealth announcements

export function announceInstruction(input: {
  /** Anyone; only pays the fee. */
  payer: Address
  /** The sender's ephemeral public key R (32 bytes, as an address-shaped value). */
  ephemeral: Address
  stealth: Address
  viewTag: number
}): Instruction {
  return build(
    'announce',
    { payer: input.payer },
    concat(addressBytes(input.ephemeral), addressBytes(input.stealth), Uint8Array.of(input.viewTag)),
  )
}

export interface StealthAnnouncementEvent {
  /** The sender's ephemeral public key R, as raw bytes. */
  ephemeral: Uint8Array
  stealth: Address
  viewTag: number
}

const ANNOUNCEMENT_DISCRIMINATOR = Uint8Array.from(idl.events.find((e) => e.name === 'StealthAnnouncement')!.discriminator)
const PROGRAM_DATA_PREFIX = 'Program data: '

/** Extract stealth announcements from a transaction's log messages (anything else is ignored). */
export function parseAnnouncements(logMessages: readonly string[]): StealthAnnouncementEvent[] {
  const found: StealthAnnouncementEvent[] = []
  for (const line of logMessages) {
    if (!line.startsWith(PROGRAM_DATA_PREFIX)) continue
    let bytes: Uint8Array
    try {
      bytes = Uint8Array.from(atob(line.slice(PROGRAM_DATA_PREFIX.length)), (c) => c.charCodeAt(0))
    } catch {
      continue
    }
    if (bytes.length !== 8 + 32 + 32 + 1 || !ANNOUNCEMENT_DISCRIMINATOR.every((b, i) => bytes[i] === b)) continue
    found.push({
      ephemeral: bytes.slice(8, 40),
      stealth: addressFromBytes(bytes.subarray(40, 72)),
      viewTag: bytes[72],
    })
  }
  return found
}
