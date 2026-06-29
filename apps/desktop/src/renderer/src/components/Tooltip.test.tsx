// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

  // On an editable trigger (a metadata input), surfacing the value-tooltip the instant the
  // field is focused covers the text the user is about to type. hoverOnly opts that trigger
  // out of the focus reveal so the tooltip stays a pure hover hint, never popping mid-edit.
  it('does not appear on focus when hoverOnly is set', () => {
    render(
      <span data-testid="trigger">
        <input />
        <Tooltip label="Helpful hint" hoverOnly />
      </span>,
    )
    fireEvent.focusIn(screen.getByTestId('trigger'))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  // A hover tooltip that pops up the instant the pointer crosses a control feels cheap
  // and clutters quick passes; like a native help tag it should wait out a short pause.
  // jsdom's synthetic PointerEvent drops clientX/clientY, so drive the listener with a
  // real MouseEvent (which carries them) dispatched as a pointermove.
  const hover = (trigger: HTMLElement): void => {
    trigger.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 10, clientY: 10, bubbles: true }),
    )
  }

  it('waits out a short hover before appearing', () => {
    vi.useFakeTimers()
    try {
      renderTooltip()
      const trigger = screen.getByTestId('trigger')
      hover(trigger)
      expect(screen.queryByRole('tooltip')).toBeNull()
      act(() => vi.advanceTimersByTime(400))
      expect(screen.getByRole('tooltip')).toHaveTextContent('Helpful hint')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not appear if the pointer leaves before the hover delay elapses', () => {
    vi.useFakeTimers()
    try {
      renderTooltip()
      const trigger = screen.getByTestId('trigger')
      hover(trigger)
      fireEvent.pointerLeave(trigger)
      act(() => vi.advanceTimersByTime(400))
      expect(screen.queryByRole('tooltip')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  // 1.4.13 requires the hint be dismissable without moving the pointer or focus.
  it('dismisses on Escape while the trigger keeps focus', () => {
    renderTooltip()
    fireEvent.focusIn(screen.getByTestId('trigger'))
    fireEvent.keyDown(screen.getByTestId('trigger'), { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
