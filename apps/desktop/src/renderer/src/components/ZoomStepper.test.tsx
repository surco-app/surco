// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZoomStepper } from './ZoomStepper'

afterEach(cleanup)

function stepper(over: Partial<React.ComponentProps<typeof ZoomStepper>> = {}) {
  return render(
    <ZoomStepper
      label="×32"
      onOut={() => {}}
      onIn={() => {}}
      onReset={() => {}}
      labels={{ out: 'Zoom out', in: 'Zoom in', reset: 'Reset zoom' }}
      testids={{ out: 'zoom-out', in: 'zoom-in', reset: 'zoom-reset' }}
      {...over}
    />,
  )
}

describe('ZoomStepper', () => {
  // The reason this component exists. Each section had grown its own zoom and they
  // disagreed on which side "closer" lived, because each had ordered its buttons by
  // its own NUMBER: zooming in makes the beatgrid's factor climb (×1 → ×32) but makes
  // the trim's context shrink (±15 s → ±2 s). Ordering by the ACTION — less left, more
  // right, like every volume control — is what makes the gesture the same everywhere,
  // and it is the whole point of sharing one component.
  it('always puts less on the left and more on the right', () => {
    stepper()
    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).toHaveAttribute('data-testid', 'zoom-out')
    expect(buttons[1]).toHaveAttribute('data-testid', 'zoom-reset')
    expect(buttons[2]).toHaveAttribute('data-testid', 'zoom-in')
  })

  it('steps out, steps in, and resets from the value', () => {
    const onOut = vi.fn()
    const onIn = vi.fn()
    const onReset = vi.fn()
    stepper({ onOut, onIn, onReset })
    fireEvent.click(screen.getByTestId('zoom-out'))
    expect(onOut).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByTestId('zoom-in'))
    expect(onIn).toHaveBeenCalledOnce()
    // The level between the steps IS the reset — it was already clickable, but
    // rendered as bare text nobody could tell.
    fireEvent.click(screen.getByTestId('zoom-reset'))
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('shows the caller-formatted level and disables the ends it is told to', () => {
    stepper({ label: '±5s', outDisabled: true, resetDisabled: true })
    expect(screen.getByTestId('zoom-reset')).toHaveTextContent('±5s')
    expect(screen.getByTestId('zoom-out')).toBeDisabled()
    expect(screen.getByTestId('zoom-reset')).toBeDisabled()
    expect(screen.getByTestId('zoom-in')).toBeEnabled()
  })
})
