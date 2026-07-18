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

describe('Tooltip pointer listeners', () => {
  // A tooltip costs whatever it binds, times every row on screen. The track list carries
  // seven of them per row, so binding the full cursor-tracking machinery up front cost ~42
  // listeners a row — around 21,000 across a 500-track crate, every one of them idle,
  // because a pointer is only ever over one row at a time. So the resting cost is a single
  // pointerenter, and the tracking listeners are bound on the row the cursor actually
  // reaches. Focus stays bound eagerly: a keyboard user never fires pointerenter, and the
  // unmount-cleanup has to be able to close a tooltip the focus opened.
  it('binds the cursor-tracking listeners only once the pointer arrives', () => {
    // Spy on the prototype so the bindings made inside the mount effect are caught, then
    // keep only the ones aimed at this trigger — jsdom binds plenty of its own elsewhere.
    const add = vi.spyOn(HTMLElement.prototype, 'addEventListener')
    render(
      <button type="button" data-testid="trigger">
        Go
        <Tooltip label="Helpful hint" />
      </button>,
    )
    const trigger = screen.getByTestId('trigger')
    const boundOnTrigger = (): string[] =>
      add.mock.calls
        .filter((_, i) => add.mock.contexts[i] === trigger)
        .map(([type]) => type as string)

    // At rest: nothing follows the cursor, but focus already works — a keyboard user never
    // fires pointerenter, and the tooltip has to surface for them too.
    expect(boundOnTrigger()).not.toContain('pointermove')
    expect(boundOnTrigger()).toContain('focusin')
    expect(boundOnTrigger()).toContain('pointerenter')

    fireEvent.pointerEnter(trigger)

    expect(boundOnTrigger()).toContain('pointermove')
    add.mockRestore()
  })
})

describe('Tooltip', () => {
  // The listeners are the only thing that ever hid the tooltip, so a trigger that
  // disappears while it is up (its section folds, the view switches) used to strand
  // the portal on screen — a hint hanging over unrelated content, belonging to a
  // button that no longer exists.
  it('closes when its trigger unmounts while it is showing', () => {
    const { unmount } = renderTooltip()
    fireEvent.focusIn(screen.getByTestId('trigger'))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    unmount()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  // A hint shown only on hover is invisible to keyboard users; focusing the control
  // must surface the same information (WCAG 1.4.13).
  it('appears when the trigger is focused', () => {
    renderTooltip()
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.focusIn(screen.getByTestId('trigger'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Helpful hint')
  })

  // Clicking a button focuses it, and the focus reveal used to re-open the tooltip the
  // click's own pointerdown had just hidden — leaving the hint stranded over the control
  // until the pointer moved away (djotas's stuck "Regenerate filename" block). A focus
  // that arrives right after a pointerdown on the trigger is a mouse click, not keyboard
  // navigation, so it must not raise the tooltip; only a keyboard focus does.
  it('does not reappear on the focus a click puts on the trigger', () => {
    renderTooltip()
    const trigger = screen.getByTestId('trigger')
    fireEvent.pointerDown(trigger)
    fireEvent.focusIn(trigger)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  // A keyboard focus (no preceding pointerdown) still reveals it — that is the whole
  // point of the focus path for keyboard users.
  it('still appears on a keyboard focus with no preceding click', () => {
    renderTooltip()
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
  // real MouseEvent (which carries them).
  //
  // Enter THEN move, in that order, because that is what a real pointer does — and the
  // tooltip now leans on it: the cursor-tracking listeners are bound lazily on
  // pointerenter, so that event is what arms everything the hover depends on.
  const hover = (trigger: HTMLElement): void => {
    for (const type of ['pointerenter', 'pointermove']) {
      trigger.dispatchEvent(new MouseEvent(type, { clientX: 10, clientY: 10, bubbles: true }))
    }
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
