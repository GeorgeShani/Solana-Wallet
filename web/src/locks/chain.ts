import { address, type Address } from '@solana/addresses'
import type { Instruction } from '@solana/instructions'
import {
  cancelTimelockInstruction,
  closeTokenAccount,
  createAssociatedTokenAccountIdempotent,
  createTimelockInstruction,
  decodeTimelock,
  deriveTimelockAddresses,
  findAssociatedTokenAddress,
  PROGRAM_ADDRESS,
  syncNative,
  systemTransfer,
  TIMELOCK_SIZE,
  withdrawTimelockInstruction,
  type DecodedTimelock,
} from '@wallet/program-client'
import { WSOL_MINT } from '@wallet/shared'
import { rpc } from '../wallet/rpc'

export interface TimelockInfo extends DecodedTimelock {
  /** The timelock account's address. */
  account: Address
}

/** Timelocks where `who` is the `role`. The sender pubkey is at offset 8, the recipient's at 40. */
export async function fetchTimelocks(role: 'sender' | 'recipient', who: string): Promise<TimelockInfo[]> {
  const accounts = await rpc
    .getProgramAccounts(PROGRAM_ADDRESS, {
      encoding: 'base64',
      commitment: 'confirmed',
      filters: [
        { dataSize: BigInt(TIMELOCK_SIZE) },
        { memcmp: { offset: role === 'sender' ? 8n : 40n, bytes: who as never, encoding: 'base58' } },
      ],
    })
    .send()
  const locks: TimelockInfo[] = []
  for (const { pubkey, account } of accounts) {
    try {
      locks.push({ ...decodeTimelock(Uint8Array.from(atob(account.data[0]), (c) => c.charCodeAt(0))), account: pubkey })
    } catch {
      /* not a timelock: ignore */
    }
  }
  // soonest to finish first
  return locks.sort((a, b) => Number(a.end - b.end))
}

/** A random u64 so one sender can lock several amounts for the same recipient. */
export function randomSeed(): bigint {
  return new DataView(crypto.getRandomValues(new Uint8Array(8)).buffer).getBigUint64(0, true)
}

export interface Schedule {
  /** Unix seconds. */
  start: number
  cliff: number
  end: number
}

/**
 * Lock tokens (or SOL, wrapped for the occasion) for `recipient`. For SOL the wallet wraps it into
 * a temporary wrapped-SOL account, locks that, and closes the account again, all in one transaction.
 */
export async function buildCreateLockInstructions(input: {
  sender: string
  recipient: string
  /** Token mint, or null for SOL. */
  mint: string | null
  amount: bigint
  schedule: Schedule
  cancellable: boolean
  seed: bigint
}): Promise<Instruction[]> {
  const sender = address(input.sender)
  const recipient = address(input.recipient)
  const mint = address(input.mint ?? WSOL_MINT)
  const { timelock, vault } = await deriveTimelockAddresses(sender, recipient, input.seed, mint)
  const senderToken = await findAssociatedTokenAddress(sender, mint)

  const lock = createTimelockInstruction({
    sender,
    recipient,
    mint,
    timelock,
    vault,
    senderToken,
    seed: input.seed,
    amount: input.amount,
    start: BigInt(input.schedule.start),
    cliff: BigInt(input.schedule.cliff),
    end: BigInt(input.schedule.end),
    cancellable: input.cancellable,
  })
  if (input.mint !== null) return [lock]

  return [
    createAssociatedTokenAccountIdempotent({ payer: sender, ata: senderToken, owner: sender, mint }),
    systemTransfer({ from: sender, to: senderToken, lamports: input.amount }),
    syncNative(senderToken),
    lock,
    closeTokenAccount({ account: senderToken, destination: sender, owner: sender }),
  ]
}

/** The recipient takes what has vested. Wrapped SOL is unwrapped straight into their wallet. */
export async function buildWithdrawInstructions(lock: TimelockInfo): Promise<Instruction[]> {
  const { vault } = await deriveTimelockAddresses(lock.sender, lock.recipient, lock.seed, lock.mint)
  const recipientToken = await findAssociatedTokenAddress(lock.recipient, lock.mint)
  const ixs: Instruction[] = [
    createAssociatedTokenAccountIdempotent({ payer: lock.recipient, ata: recipientToken, owner: lock.recipient, mint: lock.mint }),
    withdrawTimelockInstruction({
      recipient: lock.recipient,
      timelock: lock.account,
      sender: lock.sender,
      mint: lock.mint,
      vault,
      recipientToken,
    }),
  ]
  if (lock.mint === WSOL_MINT) {
    ixs.push(closeTokenAccount({ account: recipientToken, destination: lock.recipient, owner: lock.recipient }))
  }
  return ixs
}

/** The sender takes back the unvested part (the recipient keeps what they earned so far). */
export async function buildCancelLockInstructions(lock: TimelockInfo): Promise<Instruction[]> {
  const { vault } = await deriveTimelockAddresses(lock.sender, lock.recipient, lock.seed, lock.mint)
  const senderToken = await findAssociatedTokenAddress(lock.sender, lock.mint)
  const ixs: Instruction[] = [
    createAssociatedTokenAccountIdempotent({ payer: lock.sender, ata: senderToken, owner: lock.sender, mint: lock.mint }),
    cancelTimelockInstruction({ sender: lock.sender, timelock: lock.account, mint: lock.mint, vault, senderToken }),
  ]
  if (lock.mint === WSOL_MINT) {
    ixs.push(closeTokenAccount({ account: senderToken, destination: lock.sender, owner: lock.sender }))
  }
  return ixs
}
