import { memo, useMemo } from 'react'
import { band, rosette } from './guillocheMath'

interface RosetteProps {
  seed: string
  layers?: number
  /** Points per loop; keep it low for small sizes. */
  detail?: number
  /** Draw itself in when it first appears. */
  draw?: boolean
  className?: string
}

/** A square rosette unique to `seed` (an address). Colour it with `color` / `text-*`. */
export const Rosette = memo(function Rosette({ seed, layers = 3, detail = 60, draw, className = '' }: RosetteProps) {
  const g = useMemo(() => rosette(seed, { layers, detail }), [seed, layers, detail])
  return (
    <svg viewBox={g.viewBox} className={`guilloche ${draw ? 'draw' : ''} ${className}`} aria-hidden="true" focusable="false">
      {g.paths.map((d, i) => (
        <path key={i} d={d} pathLength={1} />
      ))}
    </svg>
  )
})

interface BandProps {
  seed: string
  lines?: number
  draw?: boolean
  className?: string
}

/** A wide ribbon of crossing waves, unique to `seed`. Stretches to fill its box. */
export const Band = memo(function Band({ seed, lines = 12, draw, className = '' }: BandProps) {
  const g = useMemo(() => band(seed, { width: 400, height: 64, lines }), [seed, lines])
  return (
    <svg
      viewBox={g.viewBox}
      preserveAspectRatio="none"
      className={`guilloche ${draw ? 'draw' : ''} ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      {g.paths.map((d, i) => (
        <path key={i} d={d} pathLength={1} />
      ))}
    </svg>
  )
})

/**
 * A round token or account emblem: the address's own rosette with the symbol in the middle. Two
 * different tokens never look alike, and the same token always does.
 */
export function Medallion({ seed, label, size = 40 }: { seed: string; label?: string; size?: number }) {
  return (
    <span
      className="relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full border border-plate/70 bg-note text-plate"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Rosette seed={seed} layers={2} detail={22} className="absolute inset-0 h-full w-full opacity-80" />
      {label && (
        <span
          className="relative grid place-items-center rounded-full bg-note font-serial text-[9px] leading-none font-semibold text-plate"
          style={{ width: size * 0.56, height: size * 0.56 }}
        >
          {label.slice(0, 3)}
        </span>
      )}
    </span>
  )
}
