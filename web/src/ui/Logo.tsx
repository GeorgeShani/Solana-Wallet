import { BRAND_NAME, LOGO_LAYERS, LOGO_SEED } from './brand'
import { Rosette } from './Guilloche'

/** The mark: the fixed logo rosette. Size it with `size-*`; it takes the teal line ink unless you set a `text-*`. */
export function LogoMark({ draw, detail = 140, className = '' }: { draw?: boolean; detail?: number; className?: string }) {
  return <Rosette seed={LOGO_SEED} layers={LOGO_LAYERS} detail={detail} draw={draw} className={`text-plate ${className}`} />
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
