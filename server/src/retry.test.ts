import { describe, expect, test } from 'bun:test'
import { withRetry } from './retry'

const noSleep = async () => {}

describe('withRetry', () => {
  test('returns the first success without retrying', async () => {
    let calls = 0
    expect(await withRetry(async () => (calls++, 'ok'), { sleep: noSleep })).toBe('ok')
    expect(calls).toBe(1)
  })

  test('retries after failures and returns once it succeeds', async () => {
    let calls = 0
    const result = await withRetry(
      async () => {
        if (++calls < 3) throw new Error('HTTP 429')
        return 'finally'
      },
      { sleep: noSleep },
    )
    expect(result).toBe('finally')
    expect(calls).toBe(3)
  })

  test('gives up after the attempt limit and throws the last error', async () => {
    let calls = 0
    await expect(withRetry(async () => { throw new Error(`fail ${++calls}`) }, { attempts: 3, sleep: noSleep })).rejects.toThrow('fail 3')
    expect(calls).toBe(3)
  })

  test('waits longer after each failure (exponential backoff)', async () => {
    const waits: number[] = []
    await withRetry(async () => { throw new Error('x') }, { attempts: 4, baseMs: 100, sleep: async (ms) => void waits.push(ms) }).catch(() => {})
    expect(waits).toEqual([100, 200, 400]) // no wait after the final attempt
  })
})
