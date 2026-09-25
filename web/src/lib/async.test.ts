import { describe, expect, test } from 'bun:test'
import { mapLimit, retry } from './async'

const noSleep = async () => {}

describe('mapLimit', () => {
  test('keeps results in order and never exceeds the limit', async () => {
    let inFlight = 0
    let peak = 0
    const out = await mapLimit([5, 1, 4, 2, 3, 6, 7], 3, async (n) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, n))
      inFlight--
      return n * 10
    })
    expect(out).toEqual([50, 10, 40, 20, 30, 60, 70])
    expect(peak).toBeLessThanOrEqual(3)
    expect(peak).toBeGreaterThan(1)
  })
  test('handles an empty list and a limit larger than the list', async () => {
    expect(await mapLimit([], 4, async (x) => x)).toEqual([])
    expect(await mapLimit([1, 2], 10, async (x) => x + 1)).toEqual([2, 3])
  })
  test('a failure rejects the whole call', async () => {
    await expect(mapLimit([1, 2, 3], 2, async (x) => { if (x === 2) throw new Error('boom'); return x })).rejects.toThrow('boom')
  })
})

describe('retry', () => {
  test('returns the first success', async () => {
    let calls = 0
    expect(await retry(async () => (calls++, 'ok'), { sleep: noSleep })).toBe('ok')
    expect(calls).toBe(1)
  })
  test('tries again after failures', async () => {
    let calls = 0
    expect(await retry(async () => { if (++calls < 3) throw new Error('429'); return 'done' }, { sleep: noSleep })).toBe('done')
    expect(calls).toBe(3)
  })
  test('gives up with the last error and waits longer each time', async () => {
    const waits: number[] = []
    await expect(retry(async () => { throw new Error('nope') }, { attempts: 4, baseMs: 100, sleep: async (ms) => void waits.push(ms) })).rejects.toThrow('nope')
    expect(waits).toEqual([100, 200, 400])
  })
})
