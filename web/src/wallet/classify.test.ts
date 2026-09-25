import { describe, expect, test } from 'bun:test'
import { getBase58Codec } from '@solana/codecs'
import { instructionDiscriminator, MPL_CORE_PROGRAM, PROGRAM_ADDRESS } from '@wallet/program-client'
import { classifyProgramCall } from './classify'

const b58 = getBase58Codec()
const ix = (programId: string, bytes: number[]) => ({ programId, data: b58.decode(Uint8Array.from(bytes)) })
const ours = (name: string) => ix(String(PROGRAM_ADDRESS), [...instructionDiscriminator(name), 1, 2, 3])

describe('classifyProgramCall', () => {
  test('names each of the wallet program\'s actions', () => {
    expect(classifyProgramCall([ours('swap')])).toEqual({ label: 'Swap', swap: true })
    expect(classifyProgramCall([ours('create_sol_link')])?.label).toBe('Created a link')
    expect(classifyProgramCall([ours('claim_token_link')])).toEqual({ label: 'Claimed a link', direction: 'in' })
    expect(classifyProgramCall([ours('refund_sol_link')])?.direction).toBe('in')
    expect(classifyProgramCall([ours('create_timelock')])).toEqual({ label: 'Locked funds', direction: 'out' })
    expect(classifyProgramCall([ours('withdraw_timelock')])?.label).toBe('Unlocked funds')
    expect(classifyProgramCall([ours('cancel_timelock')])?.label).toBe('Cancelled a lock')
    expect(classifyProgramCall([ours('announce')])?.label).toBe('Private payment')
  })

  test('finds our instruction among token-account and system instructions', () => {
    const noise = [{ programId: '11111111111111111111111111111111' }, ix('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', [1])]
    expect(classifyProgramCall([...noise, ours('swap'), ...noise])?.label).toBe('Swap')
  })

  test('recognises Metaplex Core mints and moves', () => {
    expect(classifyProgramCall([ix(String(MPL_CORE_PROGRAM), [0, 0, 7])])?.label).toBe('Minted an NFT')
    expect(classifyProgramCall([ix(String(MPL_CORE_PROGRAM), [14, 0])])?.label).toBe('Moved an NFT')
    expect(classifyProgramCall([ix(String(MPL_CORE_PROGRAM), [99])])).toBeNull()
  })

  test('returns null for other programs, short data and junk', () => {
    expect(classifyProgramCall([])).toBeNull()
    expect(classifyProgramCall([{ programId: String(PROGRAM_ADDRESS) }])).toBeNull()
    expect(classifyProgramCall([ix(String(PROGRAM_ADDRESS), [1, 2, 3])])).toBeNull()
    expect(classifyProgramCall([ix(String(PROGRAM_ADDRESS), [9, 9, 9, 9, 9, 9, 9, 9, 9])])).toBeNull()
    expect(classifyProgramCall([{ programId: String(PROGRAM_ADDRESS), data: '0OIl not base58' }])).toBeNull()
  })
})
