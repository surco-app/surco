// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToast } from './toastContext'

afterEach(cleanup)

function Boom(): React.JSX.Element {
  const { reportError } = useToast()
  return (
    <button type="button" onClick={() => reportError('it broke')}>
      go
    </button>
  )
}

describe('useToast', () => {
  // The point of the whole context: a component two or three hops below App can say a
  // failure out loud without App threading a callback through intermediaries that have no
  // stake in the error.
  it('reports through the provider it is given', () => {
    const reportError = vi.fn()
    render(
      <ToastProvider value={{ reportError }}>
        <Boom />
      </ToastProvider>,
    )
    screen.getByRole('button').click()
    expect(reportError).toHaveBeenCalledWith('it broke')
  })

  // Without a provider it must degrade, not explode. Throwing here would upgrade "we
  // couldn't tell you the export failed" into "the app went blank" — a worse bug than the
  // silence this replaces — and would make every component that reports an error
  // untestable without mounting the provider.
  it('falls back to the console rather than throwing outside a provider', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Boom />)
    expect(() => screen.getByRole('button').click()).not.toThrow()
    expect(err).toHaveBeenCalledWith('it broke')
    err.mockRestore()
  })
})
