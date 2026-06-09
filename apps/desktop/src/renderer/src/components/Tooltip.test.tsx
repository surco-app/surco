// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Tooltip } from './Tooltip'

afterEach(cleanup)

function renderTooltip() {
  return render(
    <button type="button" data-testid="trigger">
      Go
      <Tooltip label="Helpful hint" />
    </button>,
  )
}

describe('Tooltip', () => {
  // A hint shown only on hover is invisible to keyboard users; focusing the control
  // must surface the same information (WCAG 1.4.13).
  it('appears when the trigger is focused', () => {
    renderTooltip()
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.focusIn(screen.getByTestId('trigger'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Helpful hint')
  })

  it('hides again when focus leaves the trigger', () => {
    renderTooltip()
    fireEvent.focusIn(screen.getByTestId('trigger'))
    fireEvent.focusOut(screen.getByTestId('trigger'))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  // 1.4.13 requires the hint be dismissable without moving the pointer or focus.
  it('dismisses on Escape while the trigger keeps focus', () => {
    renderTooltip()
    fireEvent.focusIn(screen.getByTestId('trigger'))
    fireEvent.keyDown(screen.getByTestId('trigger'), { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
