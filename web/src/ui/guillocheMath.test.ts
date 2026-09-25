import { describe, expect, test } from 'bun:test'
import { LOGO_LAYERS, LOGO_SEED } from './brand'
import { band, rosette, seededRandom } from './guillocheMath'

const ADDR_A = '141GfzLBSYp2qBEtqdBfJ9P3FGK99twsu6NLaE8y5z2i'
const ADDR_B = '5PgQWusbALXk1PcrPC1BVuXV87R25Rhryu9HsmJvipP4'

const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)

describe('seededRandom', () => {
  test('repeats for the same text and differs for other text', () => {
    const a = seededRandom('x'), b = seededRandom('x'), c = seededRandom('y')
    const first = [a(), a(), a()]
    expect([b(), b(), b()]).toEqual(first)
    expect([c(), c(), c()]).not.toEqual(first)
  })
  test('stays inside [0, 1)', () => {
    const r = seededRandom(ADDR_A)
    for (let i = 0; i < 2000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('rosette', () => {
  test('is the same every time for one address, and different for another', () => {
    expect(rosette(ADDR_A)).toEqual(rosette(ADDR_A))
    expect(rosette(ADDR_A).paths).not.toEqual(rosette(ADDR_B).paths)
  })

  test('draws the requested number of closed layers inside its box', () => {
    const r = rosette(ADDR_A, { size: 120, layers: 4 })
    expect(r.viewBox).toBe('0 0 120 120')
    expect(r.paths).toHaveLength(4)
    for (const d of r.paths) {
      expect(d.startsWith('M')).toBe(true)
      expect(d.endsWith('Z')).toBe(true)
      const n = numbers(d)
      expect(n.every(Number.isFinite)).toBe(true)
      expect(Math.min(...n)).toBeGreaterThanOrEqual(0)
      expect(Math.max(...n)).toBeLessThanOrEqual(120)
    }
  })

  test('stays light enough to draw dozens in a list', () => {
    const size = rosette(ADDR_A, { detail: 30 }).paths.join('').length
    expect(size).toBeLessThan(40_000)
  })

  test('every address in a sample gets a distinct pattern', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 60; i++) seen.add(rosette(`address-${i}`).paths.join('|'))
    expect(seen.size).toBe(60)
  })
})

describe('band', () => {
  test('is repeatable, seed-specific and inside its box', () => {
    const a = band(ADDR_A, { width: 300, height: 50 })
    expect(a).toEqual(band(ADDR_A, { width: 300, height: 50 }))
    expect(a.paths).not.toEqual(band(ADDR_B, { width: 300, height: 50 }).paths)
    expect(a.viewBox).toBe('0 0 300 50')
    expect(a.paths).toHaveLength(2)
    for (const d of a.paths) {
      const n = numbers(d)
      expect(n.every(Number.isFinite)).toBe(true)
      expect(Math.min(...n)).toBeGreaterThanOrEqual(0)
      expect(Math.max(...n)).toBeLessThanOrEqual(300)
    }
  })
})

describe('the logo', () => {
  test('is one fixed rosette that never changes (the icons and share image are generated from it)', () => {
    const g = rosette(LOGO_SEED, { layers: LOGO_LAYERS, detail: 90 })
    expect(g.paths).toHaveLength(3)
    expect(g.paths[0].startsWith('M87.3 195.2L100.2 192.9L110.8 183.1')).toBe(true)
    expect(g.paths[1].startsWith('M67.7 179.7L69.2 179.9')).toBe(true)
    expect(g.paths[2].startsWith('M153.5 46L155.2 47.8')).toBe(true)
  })
})
