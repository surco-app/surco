// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { ErrorBoundary } from './ErrorBoundary'

afterEach(cleanup)

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
})
