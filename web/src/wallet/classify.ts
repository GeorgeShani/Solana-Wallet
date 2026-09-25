import { getBase58Codec } from '@solana/codecs'
import { instructionDiscriminator, MPL_CORE_PROGRAM, PROGRAM_ADDRESS } from '@wallet/program-client'

/** What a transaction that called one of our programs was for, in words a person would use. */
export interface ProgramAction {
  label: string
  /** Swaps show both legs; everything else shows the net change. */
  swap?: boolean
  /** Which way the money went, when the name alone says so (a claim is always incoming). */
  direction?: 'in' | 'out'
}

const ACTIONS: Record<string, ProgramAction> = {
  swap: { label: 'Swap', swap: true },
  add_liquidity: { label: 'Added liquidity', swap: true },
  remove_liquidity: { label: 'Removed liquidity', swap: true },
  create_sol_link: { label: 'Created a link', direction: 'out' },
  create_token_link: { label: 'Created a link', direction: 'out' },
  claim_sol_link: { label: 'Claimed a link', direction: 'in' },
  claim_token_link: { label: 'Claimed a link', direction: 'in' },
  refund_sol_link: { label: 'Cancelled a link', direction: 'in' },
  refund_token_link: { label: 'Cancelled a link', direction: 'in' },
  create_timelock: { label: 'Locked funds', direction: 'out' },
  withdraw_timelock: { label: 'Unlocked funds', direction: 'in' },
  cancel_timelock: { label: 'Cancelled a lock', direction: 'in' },
  announce: { label: 'Private payment', direction: 'out' },
}

const byDiscriminator = new Map<string, ProgramAction>(
  Object.entries(ACTIONS).map(([name, action]) => [instructionDiscriminator(name).join(','), action]),
)

const b58 = getBase58Codec()

const CORE_ACTIONS: Record<number, string> = { 0: 'Minted an NFT', 14: 'Moved an NFT' }

/**
 * Looks at a transaction's top-level instructions and names what our programs were asked to do.
 * `instructions` are the RPC's parsed instructions: programs it cannot parse carry base58 `data`.
 * Returns null when none of them is ours.
 */
export function classifyProgramCall(instructions: { programId: string; data?: string }[]): ProgramAction | null {
  let found: ProgramAction | null = null
  for (const ix of instructions) {
    if (!ix.data) continue
    let bytes: Uint8Array
    try {
      bytes = Uint8Array.from(b58.encode(ix.data))
    } catch {
      continue
    }
    if (ix.programId === String(PROGRAM_ADDRESS) && bytes.length >= 8) {
      const action = byDiscriminator.get(Array.from(bytes.subarray(0, 8)).join(','))
      if (action) return action // the wallet's own program is the interesting one
    }
    if (ix.programId === String(MPL_CORE_PROGRAM) && bytes.length >= 1 && CORE_ACTIONS[bytes[0]]) {
      found = { label: CORE_ACTIONS[bytes[0]] }
    }
  }
  return found
}
