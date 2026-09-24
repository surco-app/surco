// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { ExportButton } from './ExportButton'

afterEach(cleanup)

const baseProps = {
  status: 'idle' as const,
  stale: false,
  done: false,
  outputFormat: 'aiff' as const,
  exportedFormat: null,
  withAppleMusic: false,
  withEngineDj: false,
  inPlace: false,
  destination: 'folder' as const,
  destinations: ['folder', 'appleMusic', 'engineDj', 'beside'] as const,
  onProcess: () => {},
  onSelectFormat: () => {},
  onSelectDestination: () => {},
}

// jsdom's synthetic PointerEvent drops clientX/clientY, so drive the listener with a
// real MouseEvent (which carries them) dispatched as a pointermove.
const hover = (el: HTMLElement): void => {
  // Enter then move, as a real pointer does: the Tooltip binds its cursor tracking lazily
  // on pointerenter, so a bare pointermove now lands on nothing.
  for (const type of ['pointerenter', 'pointermove']) {
    el.dispatchEvent(new MouseEvent(type, { clientX: 10, clientY: 10, bubbles: true }))
  }
}

describe('ExportButton', () => {
  // A disabled convert with no explanation leaves the user guessing; the tooltip must
  // name the empty required fields. The button itself fires no events while disabled, so
  // the wrapper carries the hover — this guards that wiring, not just the copy.
  it('explains on hover why a blocked convert is disabled', () => {
    vi.useFakeTimers()
    try {
      render(
        <ExportButton
          {...baseProps}
          incomplete
          incompleteReason="Missing required fields: Year, Genre"
        />,
      )
      expect(screen.getByTestId('process-btn')).toHaveAttribute('aria-disabled', 'true')
      hover(screen.getByTestId('process-btn-wrap'))
      act(() => vi.advanceTimersByTime(400))
      expect(screen.getByRole('tooltip')).toHaveTextContent('Missing required fields: Year, Genre')
    } finally {
      vi.useRealTimers()
    }
  })

  // What blocks the convert is said on the button itself, not on a line above it: the
  // button cannot run anyway, so its face is free, and the footer stays one control tall.
  // The action it will run once unblocked stays in its name, after the visible words, so
  // voice control still finds it by what is on screen.
  it('shows what blocks it on its face and keeps the action in its name', () => {
    render(
      <ExportButton
        {...baseProps}
        incomplete
        incompleteReason="Missing required fields: Title, Artist, Year"
        blockedLabel="3 required fields missing"
      />,
    )
    const btn = screen.getByTestId('process-btn')
    expect(btn).toHaveTextContent('3 required fields missing')
    expect(btn).toHaveAccessibleName(/^3 required fields missing · Convert/)
  })

  // A natively disabled button drops out of the Tab order, and the reason lived in a hover
  // tooltip on a wrapper nothing can focus: a keyboard or screen reader user never learnt
  // why Convert was unavailable, or that it was there at all. It stays focusable, refuses
  // to convert, and carries the reason as its description.
  it('keeps a blocked convert focusable, inert, and described by its reason', () => {
    const onProcess = vi.fn()
    render(
      <ExportButton
        {...baseProps}
        incomplete
        incompleteReason="Missing required fields: Year, Genre"
        onProcess={onProcess}
      />,
    )
    const btn = screen.getByTestId('process-btn')
    expect(btn).not.toBeDisabled()
    expect(btn).toHaveAttribute('aria-disabled', 'true')
    expect(btn).toHaveAccessibleDescription('Missing required fields: Year, Genre')
    fireEvent.click(btn)
    expect(onProcess).not.toHaveBeenCalled()
  })

  // The chevron menu now carries both halves of the button's promise ("Convert to
  // AIFF + Apple Music"): picking a destination must behave exactly like picking a
  // format — relabel only, never convert — so a misclick can't write a file or push
  // a track into a library the user didn't mean.
  it('reports a destination pick without converting', () => {
    const onProcess = vi.fn()
    const onSelectDestination = vi.fn()
    render(
      <ExportButton
        {...baseProps}
        incomplete={false}
        destination="appleMusic"
        onProcess={onProcess}
        onSelectDestination={onSelectDestination}
      />,
    )
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.click(screen.getByTestId('process-destination-engineDj'))
    expect(onSelectDestination).toHaveBeenCalledWith('engineDj')
    expect(onProcess).not.toHaveBeenCalled()
    expect(screen.queryByTestId('process-destination-engineDj')).toBeNull()
  })

  it('marks the current destination in the menu', () => {
    render(<ExportButton {...baseProps} incomplete={false} destination="engineDj" />)
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    expect(screen.getByTestId('process-destination-engineDj')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByTestId('process-destination-folder')).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  // The chevron opened a plain stack of buttons: no announced popup, focus left behind on
  // the chevron, no arrows and no Escape, so from the keyboard the menu was a trap of Tab
  // presses. It has to behave like the app's other menus (TrackContextMenu).
  it('runs the format menu as a keyboard menu of radio items', () => {
    render(<ExportButton {...baseProps} incomplete={false} outputFormat="flac" />)
    const toggle = screen.getByTestId('process-format-toggle')
    expect(toggle).toHaveAttribute('aria-haspopup', 'menu')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    toggle.focus()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu')).toBeInTheDocument()
    const flac = screen.getByTestId('process-format-flac')
    expect(flac).toHaveAttribute('role', 'menuitemradio')
    expect(flac).toHaveAttribute('aria-checked', 'true')
    expect(flac).toHaveFocus()
    fireEvent.keyDown(flac, { key: 'ArrowDown' })
    expect(flac).not.toHaveFocus()
    expect(screen.getByRole('menu')).toContainElement(document.activeElement as HTMLElement)
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(toggle).toHaveFocus()
  })

  // Picking an item closes the menu; without handing focus back, it fell to <body>.
  it('returns focus to the chevron after a pick', () => {
    render(<ExportButton {...baseProps} incomplete={false} />)
    const toggle = screen.getByTestId('process-format-toggle')
    fireEvent.click(toggle)
    fireEvent.click(screen.getByTestId('process-format-mp3'))
    expect(toggle).toHaveFocus()
  })

  // Music can't ingest FLAC, so with FLAC picked the Apple Music destination must grey
  // out — the same pin the Settings radio applies — instead of promising an add that
  // the conversion would silently skip.
  it('disables the Apple Music destination while FLAC is the picked format', () => {
    render(<ExportButton {...baseProps} incomplete={false} outputFormat="flac" />)
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    expect(screen.getByTestId('process-destination-appleMusic')).toBeDisabled()
    expect(screen.getByTestId('process-destination-beside')).toBeEnabled()
  })

  // While a track converts, the button mirrors the row in the track list: the
  // current stage as its label and a fill marking where in the pipeline the export
  // is — the same honest phase progress (STAGE_PROGRESS), not a fake percentage.
  it('shows the stage label and its progress fill while processing', () => {
    render(
      <ExportButton {...baseProps} incomplete={false} status="processing" stage="appleMusic" />,
    )
    const btn = screen.getByTestId('process-btn')
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent('Adding to Apple Music…')
    expect(screen.getByTestId('process-progress')).toHaveStyle({ width: '85%' })
  })

  // A long single convert used to be a dead progress bar with no escape. With a cancel
  // handler the button stays live while converting: clicking it stops the job instead of
  // firing another convert, so the single flow has the escape a batch always had.
  it('cancels the in-flight convert on click instead of staying a dead bar', () => {
    const onProcess = vi.fn()
    const onCancel = vi.fn()
    render(
      <ExportButton
        {...baseProps}
        incomplete={false}
        status="processing"
        stage="converting"
        onProcess={onProcess}
        onCancel={onCancel}
      />,
    )
    const btn = screen.getByTestId('process-btn')
    expect(btn).toBeEnabled()
    fireEvent.click(btn)
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onProcess).not.toHaveBeenCalled()
  })

  // The live bar cancels on press, but its name was only the stage ("Converting to
  // AIFF…") and "Cancel" appeared on mouse hover alone: a keyboard or screen reader user
  // pressed it not knowing it would stop the job. The name must say so, keep the visible
  // stage in it, and the "Cancel" swap must also show when the keyboard focus is there.
  it('names the live bar as a cancel control and shows "Cancel" on keyboard focus too', () => {
    render(
      <ExportButton
        {...baseProps}
        incomplete={false}
        status="processing"
        stage="converting"
        onCancel={vi.fn()}
      />,
    )
    const btn = screen.getByTestId('process-btn')
    expect(btn).toHaveAccessibleName(
      i18n.t('export.cancelWhile', {
        stage: `Converting to AIFF… ${i18n.t('trackList.progress', { percent: 55 })}`,
      }),
    )
    expect(btn).toHaveAccessibleName(/Converting to AIFF…/)
    expect(screen.getByText(i18n.t('common.cancel')).className).toContain(
      'group-focus-within:inline',
    )
  })

  // The fill is a bare aria-hidden span, so a screen reader heard the stage but never how
  // far along it was. A button flattens any role inside it, so the amount is in its name.
  it('speaks the progress of the converting button, live or inert', () => {
    const percent = i18n.t('trackList.progress', { percent: 55 })
    const { unmount } = render(
      <ExportButton {...baseProps} incomplete={false} status="processing" stage="converting" />,
    )
    expect(screen.getByTestId('process-btn')).toHaveAccessibleName(new RegExp(percent))
    unmount()
    render(
      <ExportButton
        {...baseProps}
        incomplete={false}
        status="processing"
        stage="converting"
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByTestId('process-btn')).toHaveAccessibleName(new RegExp(percent))
  })

  // Without a cancel handler the processing button stays the inert progress bar it was —
  // the cancel affordance is opt-in, so the multi/quiet uses are unaffected.
  it('stays a disabled bar while processing when no cancel handler is given', () => {
    render(
      <ExportButton {...baseProps} incomplete={false} status="processing" stage="converting" />,
    )
    expect(screen.getByTestId('process-btn')).toBeDisabled()
  })

  it('names the picked format in the converting stage label', () => {
    render(
      <ExportButton {...baseProps} incomplete={false} status="processing" stage="converting" />,
    )
    expect(screen.getByTestId('process-btn')).toHaveTextContent('Converting to AIFF…')
    const width = screen.getByTestId('process-progress').style.width
    expect(Number.parseFloat(width)).toBeCloseTo(55)
  })

  // The first progress event may not have landed yet: no stage, no fill — the
  // button falls back to the generic processing label instead of an empty bar.
  it('falls back to the plain processing label before the first stage lands', () => {
    render(<ExportButton {...baseProps} incomplete={false} status="processing" />)
    expect(screen.getByTestId('process-btn')).toHaveTextContent('Converting…')
    expect(screen.queryByTestId('process-progress')).not.toBeInTheDocument()
  })

  it('shows no blocked-reason tooltip once the convert is allowed', () => {
    vi.useFakeTimers()
    try {
      render(<ExportButton {...baseProps} incomplete={false} />)
      expect(screen.getByTestId('process-btn')).toBeEnabled()
      hover(screen.getByTestId('process-btn-wrap'))
      act(() => vi.advanceTimersByTime(400))
      expect(screen.queryByRole('tooltip')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  // "Same as source" only means something over several files at once — a single track's
  // own format is just its own format, so resolving it there is equivalent and more
  // informative. The menu must offer it only when converting a selection (count set).
  it('offers "Same as source" in the format menu only over a multi-selection', () => {
    render(<ExportButton {...baseProps} incomplete={false} count={2} />)
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    expect(screen.getByTestId('process-format-source')).toBeInTheDocument()
  })

  it('does not offer "Same as source" in the single-track format menu', () => {
    render(<ExportButton {...baseProps} incomplete={false} />)
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    expect(screen.queryByTestId('process-format-source')).not.toBeInTheDocument()
  })

  // Picking 'source' must reach the caller unresolved — the whole point is that
  // processAll resolves it per track, not the editor resolving it against one.
  it('reports a "source" pick without resolving it', () => {
    const onSelectFormat = vi.fn()
    render(
      <ExportButton {...baseProps} incomplete={false} count={2} onSelectFormat={onSelectFormat} />,
    )
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.click(screen.getByTestId('process-format-source'))
    expect(onSelectFormat).toHaveBeenCalledWith('source')
  })

  // With 'source' picked, the button must show the translated "Same as source" label,
  // never the raw setting uppercased ("SOURCE" means nothing to the user).
  it('shows the translated label for "Same as source", not the raw setting', () => {
    render(<ExportButton {...baseProps} incomplete={false} count={2} outputFormat="source" />)
    expect(screen.getByTestId('process-btn')).toHaveTextContent('Same as source')
    expect(screen.getByTestId('process-btn')).not.toHaveTextContent('SOURCE')
  })
})
