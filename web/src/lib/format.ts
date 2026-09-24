export function formatUnits(value: bigint, decimals: number, maxFraction = decimals): string {
  const neg = value < 0n
  const abs = neg ? -value : value
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  let frac = (abs % base).toString().padStart(decimals, '0')
  if (frac.length > maxFraction) frac = frac.slice(0, maxFraction)
  frac = frac.replace(/0+$/, '')
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg ? '-' : ''}${w}${frac ? '.' + frac : ''}`
}

/** Parse a decimal string like "1.25" into base units. Returns null if invalid. */
export function parseUnits(input: string, decimals: number): bigint | null {
  const s = input.trim()
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null
  const [whole = '0', frac = ''] = s.split('.')
  if (frac.length > decimals) return null
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0')
}

export const shortAddr = (a: string, n = 4) => (a.length > n * 2 + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a)
