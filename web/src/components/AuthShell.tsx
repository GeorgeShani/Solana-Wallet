import type { ReactNode } from 'react'
import { Rosette } from '../ui/Guilloche'

/**
 * The wallet's front door: the same note-on-plate frame as the app, with a rosette that prints
 * itself. Used before there is a wallet (create/import) and while it is locked.
 */
export default function AuthShell({ title, subtitle, children, seed = 'solana wallet' }: { title: string; subtitle?: string; children: ReactNode; seed?: string }) {
  return (
    <div className="stage">
      <Rosette seed={seed} layers={4} detail={140} className="stage-wallpaper" />
      <p className="stage-microtext" aria-hidden>
        Solana devnet · test tokens have no value
      </p>
      <div className="frame">
        <main className="page flex flex-col px-6 pt-10 pb-8">
          <div className="mb-7 text-center">
            <Rosette seed={seed} layers={3} detail={90} draw className="mx-auto mb-5 size-32 text-plate" />
            <h1 className="numeral text-[34px] leading-none">{title}</h1>
            {subtitle && <p className="mx-auto mt-2.5 max-w-[30ch] text-sm text-muted">{subtitle}</p>}
          </div>
          <div className="flex flex-1 flex-col">{children}</div>
        </main>
      </div>
    </div>
  )
}
