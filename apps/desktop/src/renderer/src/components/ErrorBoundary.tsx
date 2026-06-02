import { Component, type ErrorInfo, type ReactNode } from 'react'
import i18n from '../i18n'

interface Props {
  children: ReactNode
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
  }

  render(): ReactNode {
    const { error, info } = this.state
    if (!error) return this.props.children
    return (
      <div
        data-testid="error-boundary"
        className="flex h-screen flex-col gap-4 overflow-auto bg-[var(--color-ink)] p-8 text-sm"
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
        <button
          onClick={() => this.setState({ error: null, info: '' })}
          className="self-start rounded-lg bg-[var(--color-accent)] px-4 py-2 font-medium text-white hover:brightness-110"
        >
          {i18n.t('errorBoundary.retry')}
        </button>
      </div>
    )
  }
}
