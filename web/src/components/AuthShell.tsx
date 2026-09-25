import type { ReactNode } from 'react'
import { LogoMark } from '../ui/Logo'

/**
 * The wallet's front door: the same note-on-plate frame as the app, with the logo printing itself.
 * Used before there is a wallet (create/import), while it is locked, and on the public claim page.
 * The logo is always the same mark, on the frame and as the wallpaper on the plate behind it.
 */
export default function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="stage">
      <LogoMark tone="inherit" className="stage-wallpaper" />
      <p className="stage-microtext" aria-hidden>
        Solana devnet · test tokens have no value
      </p>
      <div className="frame">
        <main className="page flex flex-col px-6 pt-10 pb-8">
          <div className="mb-7 text-center">
            <LogoMark draw className="mx-auto mb-5 size-32" />
            <h1 className="numeral text-[34px] leading-none">{title}</h1>
            {subtitle && <p className="mx-auto mt-2.5 max-w-[30ch] text-sm text-muted">{subtitle}</p>}
          </div>
          <div className="flex flex-1 flex-col">{children}</div>
        </main>
      </div>
    </div>
  )
}
