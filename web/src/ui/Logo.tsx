import { BRAND_NAME, LOGO_LAYERS, LOGO_SEED } from './brand'
import { Rosette } from './Guilloche'

/**
 * The mark: the fixed logo rosette. Size it with `size-*`.
 *  - `draw` true: it prints itself line by line (the animated logo). Leave it off for the plain, static SVG.
 *  - `tone`: the teal line ink by default; 'inherit' lets the caller colour it.
 */
export function LogoMark({ draw, detail = 140, tone = 'plate', className = '' }: { draw?: boolean; detail?: number; tone?: 'plate' | 'inherit'; className?: string }) {
  return <Rosette seed={LOGO_SEED} layers={LOGO_LAYERS} detail={detail} draw={draw} className={`${tone === 'plate' ? 'text-plate ' : ''}${className}`} />
}

/** The mark with the product name beside it, for headers and footers. */
export function LogoLockup({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark detail={60} className="logo-heavy size-9 shrink-0" />
      <span className="numeral text-[22px] leading-none">{BRAND_NAME}</span>
    </span>
  )
}
