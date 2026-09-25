import { CheckCircle2, CircleAlert, X } from 'lucide-react'
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { ToastContext, type Toast, type ToastApi, type ToastKind as Kind } from './toastContext'

const DURATION: Record<Kind, number> = { success: 4500, info: 4500, error: 8000 }

/** Small messages that appear over the wallet and go away by themselves. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const next = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const show = useCallback(
    (message: string, kind: Kind = 'info', action?: Toast['action']) => {
      const id = next.current++
      // the same message twice in a row is one toast, not a stack of them
      setToasts((t) => [...t.filter((x) => x.message !== message), { id, kind, message, action }].slice(-3))
      setTimeout(() => dismiss(id), DURATION[kind])
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m, a) => show(m, 'success', a),
      error: (m) => show(m, 'error'),
    }),
    [show],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-20 z-50 mx-auto flex w-full max-w-[420px] flex-col gap-2 px-4"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`rise pointer-events-auto flex items-start gap-3 rounded-[6px] border bg-note px-3.5 py-3 text-sm shadow-[0_12px_28px_-12px_rgb(5_42_45/0.55)] ${
              t.kind === 'error' ? 'border-serial' : t.kind === 'success' ? 'border-ok' : 'border-plate'
            }`}
          >
            {t.kind === 'error' ? (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-serial" aria-hidden />
            ) : (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="leading-snug">{t.message}</p>
              {t.action && (
                <a className="link mt-1 inline-block text-[13px]" href={t.action.href} target="_blank" rel="noreferrer">
                  {t.action.label}
                </a>
              )}
            </div>
            <button className="-m-1 rounded p-1 text-muted hover:text-ink" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
