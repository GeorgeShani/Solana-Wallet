import { describe, expect, test } from 'bun:test'
import { relativeTime } from './useNow'

describe('relativeTime', () => {
  const now = 1_000_000
  test('future and past', () => {
    expect(relativeTime(now + 45, now)).toBe('in 45s')
    expect(relativeTime(now + 125, now)).toBe('in 2m 5s')
    expect(relativeTime(now + 3 * 3600 + 5 * 60, now)).toBe('in 3h 5m')
    expect(relativeTime(now + 2 * 86400 + 4 * 3600, now)).toBe('in 2d 4h')
    expect(relativeTime(now - 90, now)).toBe('1m 30s ago')
    expect(relativeTime(now - 86400, now)).toBe('1d 0h ago')
  })
  test('within a few seconds counts as now', () => {
    expect(relativeTime(now, now)).toBe('now')
    expect(relativeTime(now + 4, now)).toBe('now')
    expect(relativeTime(now - 4, now)).toBe('now')
  })
})
