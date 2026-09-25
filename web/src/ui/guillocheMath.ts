// Guilloche: the interlaced curve patterns printed on banknotes. Here every address (wallet, token,
// NFT) turns into its own pattern, so a glance tells two of them apart. Purely decorative: nothing
// here is security-relevant, so a plain string hash is enough.

/** Turns any text into a stream of repeatable pseudo-random numbers in [0, 1). */
export function seededRandom(text: string): () => number {
  // cyrb128-style mixing to a 32-bit state, then mulberry32
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  let a = (h1 ^ h2 ^ h3 ^ h4) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
const fmt = (n: number) => (Math.round(n * 10) / 10).toString()

export interface GuillochePaths {
  /** e.g. "0 0 200 200". */
  viewBox: string
  /** One SVG path per line family; stroke them thin. */
  paths: string[]
}

export interface RosetteOptions {
  /** Width and height of the square drawing area. */
  size?: number
  /** How many interlaced curves. */
  layers?: number
  /** Points per loop: higher is smoother and heavier. */
  detail?: number
}

/**
 * A rosette: several hypotrochoid curves (the path of a point on a small wheel rolling inside a
 * big one) of different shapes, stacked and slightly turned against each other.
 */
export function rosette(seed: string, { size = 200, layers = 3, detail = 90 }: RosetteOptions = {}): GuillochePaths {
  const rand = seededRandom(`rosette:${seed}`)
  const half = size / 2
  const paths: string[] = []
  for (let layer = 0; layer < layers; layer++) {
    // a: teeth of the big wheel, b: of the small one. Coprime, so the curve closes after b turns.
    const a = 7 + Math.floor(rand() * 9) // 7..15
    let b = 2 + Math.floor(rand() * (a - 3))
    while (gcd(a, b) !== 1) b++
    const reach = 0.55 + rand() * 0.45 // how far the pen sticks out from the small wheel
    const h = (a - b) * reach
    const spin = rand() * Math.PI * 2
    const outer = a - b + h
    const scale = (half * (0.96 - layer * 0.1)) / outer
    const steps = detail * b
    let d = ''
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2 * b
      const x = (a - b) * Math.cos(t) + h * Math.cos(((a - b) / b) * t)
      const y = (a - b) * Math.sin(t) - h * Math.sin(((a - b) / b) * t)
      const rx = x * Math.cos(spin) - y * Math.sin(spin)
      const ry = x * Math.sin(spin) + y * Math.cos(spin)
      d += `${i === 0 ? 'M' : 'L'}${fmt(half + rx * scale)} ${fmt(half + ry * scale)}`
    }
    paths.push(d + 'Z')
  }
  return { viewBox: `0 0 ${size} ${size}`, paths }
}

export interface BandOptions {
  width?: number
  height?: number
  /** Lines per family. */
  lines?: number
}

/**
 * A band: the flowing lattice printed along the edges of a note. Two families of waves cross each
 * other and pinch together in the middle, like the ribbons on a banknote's border.
 */
export function band(seed: string, { width = 400, height = 64, lines = 14 }: BandOptions = {}): GuillochePaths {
  const rand = seededRandom(`band:${seed}`)
  const paths: string[] = []
  const samples = Math.max(60, Math.round(width / 5))
  for (let family = 0; family < 2; family++) {
    const cycles = 1.5 + Math.floor(rand() * 3) + family * 0.5
    const amp = height * (0.28 + rand() * 0.14)
    const phase = rand() * Math.PI * 2
    const lag = (Math.PI * (0.6 + rand() * 0.5)) / lines
    let d = ''
    for (let i = 0; i < lines; i++) {
      for (let s = 0; s <= samples; s++) {
        const u = s / samples
        const envelope = 0.35 + 0.65 * Math.abs(Math.sin(Math.PI * u * (1 + family)))
        const y = height / 2 + Math.sin(u * Math.PI * 2 * cycles + phase + i * lag * (family ? -1 : 1)) * amp * envelope
        d += `${s === 0 ? 'M' : 'L'}${fmt(u * width)} ${fmt(y)}`
      }
    }
    paths.push(d)
  }
  return { viewBox: `0 0 ${width} ${height}`, paths }
}
