import { Component, type ErrorInfo, type ReactNode } from 'react'
import i18n from '../i18n'
import { openFeedback } from '../lib/feedback'

interface Props {
  children: ReactNode
  // Container class for the fallback. The root boundary fills the screen; the one
  // around the editor panel stays inside the panel so the track list survives.
  className?: string
}

interface State {
  error: Error | null
  info: string
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info: info.componentStack ?? '' })
    console.error(error, info.componentStack)
    // console.error dies with the window; the log file is what a user can attach
    // to a report, so the crash has to reach main too.
    window.api.logError(error.message, `${error.stack ?? ''}${info.componentStack ?? ''}`)
  }

  render(): ReactNode {
    const { error, info } = this.state
    if (!error) return this.props.children
    return (
      <div
        data-testid="error-boundary"
        className={
          this.props.className ??
          'flex h-screen flex-col gap-4 overflow-auto bg-[var(--color-ink)] p-8 text-sm'
        }
      >
        <h1 className="text-lg font-semibold text-danger">{i18n.t('errorBoundary.title')}</h1>
        <pre className="whitespace-pre-wrap break-words rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] p-4 text-danger">
          {error.message}
        </pre>
        {(error.stack || info) && (
          <pre className="whitespace-pre-wrap break-words rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] p-4 text-fg-muted">
            {error.stack ?? info}
          </pre>
        )}
        <div className="flex gap-2 self-start">
          <button
            type="button"
            data-testid="error-retry"
            onClick={() => this.setState({ error: null, info: '' })}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 font-medium text-white hover:brightness-110"
          >
            {i18n.t('errorBoundary.retry')}
          </button>
          <button
            type="button"
            data-testid="report-crash"
            onClick={() => openFeedback(error.message)}
            className="rounded-lg border border-[var(--color-line)] px-4 py-2 font-medium text-fg-muted hover:bg-[var(--color-panel)]"
          >
            {i18n.t('errorBoundary.report')}
          </button>
          <button
            type="button"
            data-testid="reveal-log"
            onClick={() => window.api.revealLog()}
            className="rounded-lg border border-[var(--color-line)] px-4 py-2 font-medium text-fg-muted hover:bg-[var(--color-panel)]"
          >
            {i18n.t('errorBoundary.revealLog')}
          </button>
        </div>
      </div>
    )
  }
}
