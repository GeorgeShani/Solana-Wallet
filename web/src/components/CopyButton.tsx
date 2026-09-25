import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

export default function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="inline-flex min-h-8 items-center gap-1.5 rounded-[6px] border border-plate/40 px-2.5 text-xs font-semibold text-plate transition hover:border-plate hover:bg-plate/6"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {done ? <Check className="size-3.5 text-ok" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      <span aria-live="polite">{done ? 'Copied' : label}</span>
    </button>
  )
}
