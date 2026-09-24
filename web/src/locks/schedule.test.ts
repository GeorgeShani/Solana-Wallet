import { describe, expect, test } from 'bun:test'
import { vestedAmount } from '@wallet/shared'
import { buildSchedule, fromDateTimeLocal, MIN_LEAD_SECONDS, toDateTimeLocal, validateSchedule } from './schedule'

const now = 1_800_000_000

describe('schedules', () => {
  test('"unlock on a date" is start = cliff = end', () => {
    expect(buildSchedule({ mode: 'date', unlockAt: now + 3600 })).toEqual({ start: now + 3600, cliff: now + 3600, end: now + 3600 })
  })

  test('vesting runs from now, with an optional cliff', () => {
    expect(buildSchedule({ mode: 'vest', now, duration: 1000, cliffFraction: 0 })).toEqual({ start: now, cliff: now, end: now + 1000 })
    expect(buildSchedule({ mode: 'vest', now, duration: 1000, cliffFraction: 0.25 })).toEqual({ start: now, cliff: now + 250, end: now + 1000 })
  })

  test('built schedules always satisfy the program: start <= cliff <= end', () => {
    for (const cliffFraction of [0, 0.25, 0.5, 1]) {
      for (const duration of [300, 3600, 86_400, 31_536_000]) {
        const s = buildSchedule({ mode: 'vest', now, duration, cliffFraction })
        expect(s.start <= s.cliff && s.cliff <= s.end).toBe(true)
      }
    }
  })

  test('the vesting behaviour matches what the form promises', () => {
    const s = buildSchedule({ mode: 'vest', now, duration: 1000, cliffFraction: 0.5 })
    const at = (t: number) => vestedAmount(1_000n, BigInt(s.start), BigInt(s.cliff), BigInt(s.end), BigInt(now + t))
    expect([at(0), at(499), at(500), at(750), at(1000)]).toEqual([0n, 0n, 500n, 750n, 1000n])
  })

  test('validation rejects past or too-soon unlocks and disordered schedules', () => {
    expect(validateSchedule({ start: now, cliff: now, end: now + 3600 }, now)).toBeNull()
    expect(validateSchedule({ start: now, cliff: now, end: now + MIN_LEAD_SECONDS - 1 }, now)).toMatch(/at least a minute/)
    expect(validateSchedule({ start: now - 100, cliff: now - 100, end: now - 100 }, now)).toMatch(/at least a minute/)
    expect(validateSchedule({ start: now + 10, cliff: now, end: now + 3600 }, now)).toMatch(/out of order/)
  })

  test('datetime-local round-trips in the local timezone', () => {
    const t = 1_800_003_600
    const local = toDateTimeLocal(t)
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    // minutes precision: the round trip lands on the same minute
    expect(fromDateTimeLocal(local)).toBe(t - (t % 60))
    expect(fromDateTimeLocal('')).toBeNull()
    expect(fromDateTimeLocal('not a date')).toBeNull()
  })
})
