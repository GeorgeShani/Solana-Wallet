import { describe, expect, test } from 'bun:test'
import { formatUnits, parseUnits } from './format'

describe('format', () => {
  test('formatUnits', () => {
    expect(formatUnits(1_500_000_000n, 9)).toBe('1.5')
    expect(formatUnits(1n, 9)).toBe('0.000000001')
    expect(formatUnits(1_000_000n, 6)).toBe('1')
    expect(formatUnits(1234567890123n, 9, 4)).toBe('1,234.5678')
    expect(formatUnits(-2_500_000n, 6)).toBe('-2.5')
  })
  test('parseUnits', () => {
    expect(parseUnits('1.25', 9)).toBe(1_250_000_000n)
    expect(parseUnits('.5', 6)).toBe(500_000n)
    expect(parseUnits('3', 6)).toBe(3_000_000n)
    expect(parseUnits('0.0000001', 6)).toBeNull() // too many decimals
    expect(parseUnits('abc', 6)).toBeNull()
    expect(parseUnits('', 6)).toBeNull()
    expect(parseUnits('1.2.3', 6)).toBeNull()
  })
})
