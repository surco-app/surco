// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { ErrorBoundary } from './ErrorBoundary'

afterEach(cleanup)

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = { logError: vi.fn(), revealLog: vi.fn() }
})

function Bomb({ defused }: { defused?: boolean }): React.JSX.Element {
  if (!defused) throw new Error('boom')
  return <p>recovered</p>
}

describe('ErrorBoundary', () => {
  // The boundary now also wraps the editor panel: a render bug in one subtree must
  // degrade to a contained fallback (the rest of the app stays alive), and Retry must
  // actually bring the subtree back once the bad input is gone.
  it('contains a child crash and recovers on retry', () => {
    const silenced = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rerender } = render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )
    expect(screen.getByTestId('error-boundary')).toBeInTheDocument()
    expect(screen.getByTestId('error-boundary')).toHaveTextContent('boom')

    rerender(
      <ErrorBoundary>
        <Bomb defused />
      </ErrorBoundary>,
    )
    fireEvent.click(screen.getByTestId('error-retry'))
    expect(screen.getByText('recovered')).toBeInTheDocument()
    silenced.mockRestore()
  })

  // console.error dies with the window: the crash has to reach main's log file or a
  // user report ("it went blank") is undebuggable — there is no telemetry by design.
  it('persists the crash to the main log file', () => {
    const silenced = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )
    const { logError } = (window as unknown as { api: { logError: ReturnType<typeof vi.fn> } }).api
    expect(logError).toHaveBeenCalledWith('boom', expect.stringContaining('Bomb'))
    silenced.mockRestore()
  })

  // The crash screen tells the user to report the error; the log file is what makes
  // that report actionable, so it must be reachable right there.
  it('reveals the log file from the crash screen', () => {
    const silenced = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )
    fireEvent.click(screen.getByTestId('reveal-log'))
    const { revealLog } = (window as unknown as { api: { revealLog: ReturnType<typeof vi.fn> } })
      .api
    expect(revealLog).toHaveBeenCalledTimes(1)
    silenced.mockRestore()
  })
})
