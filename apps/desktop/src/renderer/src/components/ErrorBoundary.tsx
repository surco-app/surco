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
        <div className="flex gap-2 self-start">
          <button
            type="button"
            data-testid="error-retry"
            onClick={() => this.setState({ error: null, info: '' })}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 font-medium text-[var(--color-on-accent)] hover:brightness-110"
          >
            {i18n.t('errorBoundary.retry')}
          </button>
          <button
            type="button"
            data-testid="report-crash"
            onClick={() => openFeedback(error.message, error.stack ?? info)}
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
        {/* Below the buttons and folded: the frames are what makes a report debuggable
            (and the report button sends them either way), but printed open they filled
            the screen ABOVE the actions — putting the only useful part of a crash under
            the part a DJ cannot read. Opening it pushes nothing out of reach now. */}
        {(error.stack || info) && (
          <details data-testid="error-stack" className="self-start">
            <summary className="cursor-pointer text-fg-muted hover:text-fg">
              {i18n.t('errorBoundary.details')}
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] p-4 text-fg-muted">
              {error.stack ?? info}
            </pre>
          </details>
        )}
      </div>
    )
  }
}
