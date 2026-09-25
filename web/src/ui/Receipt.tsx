import { ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
import { explorerTx } from '../config'
import { shortAddr } from '../lib/format'
import { Rosette } from './Guilloche'

export interface ReceiptLine {
  label: string
  value: ReactNode
}

/**
 * The result of a confirmed transaction, printed like a note: a seal drawn from the transaction's
 * own signature, then each line struck onto the sheet in turn. Nothing here can be faked by the
 * page: the signature is a real one, and the explorer link lets anyone check it.
 */
export default function Receipt({
  title,
  lines,
  signature,
  children,
}: {
  title: string
  lines: ReceiptLine[]
  /** The confirmed transaction's signature. */
  signature?: string
  /** Buttons for what to do next. */
  children?: ReactNode
}) {
  return (
    <div className="rise space-y-5">
      <div className="banknote receipt-edge px-5 pt-6 pb-8 text-center" role="status">
        <div className="relative mx-auto mb-3 size-24 text-plate">
          <Rosette seed={signature ?? title} layers={3} detail={50} draw className="size-full" />
          <span className="absolute inset-[27%] grid place-items-center rounded-full bg-note">
            <svg viewBox="0 0 24 24" className="size-7 text-ok" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12.5l4.2 4.2L19 7" pathLength={1} className="draw-check" />
            </svg>
          </span>
        </div>
        <h2 className="numeral text-[28px] leading-tight">{title}</h2>
        <div className="mx-auto mt-2 h-[3px] w-24 rounded-full" style={{ background: 'var(--foil)' }} aria-hidden />

        <dl className="mt-5 space-y-2.5 text-left text-sm">
          {lines.map((l, i) => (
            <div key={l.label} className="strike flex items-start justify-between gap-4" style={{ ['--i' as string]: i + 1 }}>
              <dt className="text-muted">{l.label}</dt>
              <dd className="min-w-0 text-right font-medium break-words">{l.value}</dd>
            </div>
          ))}
        </dl>

        {signature && (
          <div className="strike mt-5 border-t border-dashed border-line pt-3" style={{ ['--i' as string]: lines.length + 2 }}>
            <div className="serial break-all">Nº {shortAddr(signature, 10)}</div>
            <a className="link mt-2 inline-flex items-center gap-1.5 text-[13px]" href={explorerTx(signature)} target="_blank" rel="noreferrer">
              Check it on Solana Explorer <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </div>
        )}
      </div>
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  )
}
