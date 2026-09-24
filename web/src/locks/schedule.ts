import type { Schedule } from './chain'

export const DURATIONS = [
  { label: '5 minutes', seconds: 300 },
  { label: '1 hour', seconds: 3_600 },
  { label: '1 day', seconds: 86_400 },
  { label: '30 days', seconds: 30 * 86_400 },
  { label: '1 year', seconds: 365 * 86_400 },
]

/** How much of the vesting period passes before anything unlocks. */
export const CLIFFS = [
  { label: 'None', fraction: 0 },
  { label: '25% of the time', fraction: 0.25 },
  { label: '50% of the time', fraction: 0.5 },
]

/** Local clocks and the chain's clock differ by a few seconds; keep a margin so a lock isn't born already over. */
export const MIN_LEAD_SECONDS = 60

export type ScheduleInput =
  | { mode: 'date'; unlockAt: number }
  | { mode: 'vest'; now: number; duration: number; cliffFraction: number }

/**
 * "Unlock on a date": nothing until that moment, then everything (start = cliff = end).
 * "Vest gradually": a straight line from now to `duration` later, optionally with a cliff that
 * holds everything back for a fraction of that time (then releases what accrued, and continues).
 */
export function buildSchedule(input: ScheduleInput): Schedule {
  if (input.mode === 'date') return { start: input.unlockAt, cliff: input.unlockAt, end: input.unlockAt }
  const end = input.now + input.duration
  return { start: input.now, cliff: input.now + Math.round(input.duration * input.cliffFraction), end }
}

/** A message for the user if the schedule can't be used, else null. */
export function validateSchedule(s: Schedule, now: number): string | null {
  if (!(s.start <= s.cliff && s.cliff <= s.end)) return 'The schedule is out of order.'
  if (s.end < now + MIN_LEAD_SECONDS) return 'The unlock time must be at least a minute from now.'
  return null
}

/** Value for a `datetime-local` input, in the user's timezone. */
export function toDateTimeLocal(unix: number): string {
  const d = new Date(unix * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Parse a `datetime-local` value (user's timezone) to unix seconds, or null if empty/invalid. */
export function fromDateTimeLocal(text: string): number | null {
  if (!text) return null
  const ms = new Date(text).getTime()
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}
