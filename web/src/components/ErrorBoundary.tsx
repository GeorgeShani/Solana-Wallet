import { Component, type ReactNode } from 'react'
import { LogoMark } from '../ui/Logo'

/** Catches a crash in any screen so people see a calm message and a way out, not a blank page. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error(error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="grid min-h-full place-items-center bg-paper p-6 text-center">
        <div className="max-w-xs space-y-4">
          <LogoMark className="mx-auto size-20" />
          <h1 className="numeral text-3xl">Something went wrong</h1>
          <p className="text-sm text-muted">
            The wallet hit an unexpected problem. Your money and recovery phrase are safe. Reloading usually fixes it.
          </p>
          <button className="btn-primary w-full" onClick={() => location.reload()}>
            Reload the wallet
          </button>
        </div>
      </div>
    )
  }
}
