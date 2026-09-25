import { createContext, useContext } from 'react'

export type ToastKind = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
  /** An optional link, e.g. "View on explorer". */
  action?: { label: string; href: string }
}

export interface ToastApi {
  show: (message: string, kind?: ToastKind, action?: Toast['action']) => void
  success: (message: string, action?: Toast['action']) => void
  error: (message: string) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast must be used inside <ToastProvider>')
  return api
}
