import { describe, expect, test } from 'bun:test'
import { friendlyError, TransactionFailedError } from './errors'

describe('friendlyError', () => {
  test('slippage failures from a confirmed transaction (6003)', () => {
    const e = new TransactionFailedError({ InstructionError: [3, { Custom: 6003 }] })
    expect(friendlyError(e)).toContain('slippage tolerance')
  })

  test('slippage failures reported in a preflight error message', () => {
    expect(friendlyError(new Error('Transaction simulation failed: custom program error: #6003'))).toContain(
      'slippage tolerance',
    )
    expect(friendlyError(new Error('custom program error: 0x1773'))).toContain('slippage tolerance') // 0x1773 = 6003
  })

  test("other program errors use the program's own message from the IDL", () => {
    expect(friendlyError(new TransactionFailedError({ InstructionError: [0, { Custom: 6002 }] }))).toBe(
      'Amount must be greater than zero.',
    )
    expect(friendlyError(new TransactionFailedError({ InstructionError: [0, { Custom: 6004 }] }))).toBe(
      'Pool does not have enough liquidity for this trade.',
    )
  })

  test('insufficient funds and busy network', () => {
    expect(friendlyError(new Error('custom program error: #1'))).toBe('Insufficient funds for this transaction.')
    expect(friendlyError(new Error('Blockhash not found'))).toBe('The network was busy. Please try again.')
  })

  test('unknown errors pass through, truncated', () => {
    expect(friendlyError(new Error('boom'))).toBe('boom')
    expect(friendlyError(new Error('x'.repeat(500))).length).toBe(201)
    expect(friendlyError('a plain string')).toBe('a plain string')
  })
})
