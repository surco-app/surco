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
  sameFormat: false,
  destination: {
    location: 'folder' as const,
    appleMusic: false,
    engineDj: false,
    keepOutputCopy: true,
  },
  locations: ['folder', 'beside'] as const,
  mac: true,
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
      expect(screen.getByTestId('process-btn')).toBeDisabled()
      hover(screen.getByTestId('process-btn-wrap'))
      act(() => vi.advanceTimersByTime(400))
      expect(screen.getByRole('tooltip')).toHaveTextContent('Missing required fields: Year, Genre')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a location pick without converting, leaving every library', () => {
    const onProcess = vi.fn()
    const onSelectDestination = vi.fn()
    render(
      <ExportButton
        {...baseProps}
        incomplete={false}
        destination={{ ...baseProps.destination, appleMusic: true, engineDj: true }}
        onProcess={onProcess}
        onSelectDestination={onSelectDestination}
      />,
    )
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.click(screen.getByTestId('process-location-beside'))
    expect(onSelectDestination).toHaveBeenCalledWith(
      expect.objectContaining({ location: 'beside', appleMusic: false, engineDj: false }),
    )
    expect(onProcess).not.toHaveBeenCalled()
    expect(screen.queryByTestId('process-location-beside')).toBeNull()
  })

  it('adds a DJ software for this conversion without converting or closing the menu', () => {
    const onProcess = vi.fn()
    const onSelectDestination = vi.fn()
    render(
      <ExportButton
        {...baseProps}
        incomplete={false}
        destination={{ ...baseProps.destination, appleMusic: true, keepOutputCopy: false }}
        onProcess={onProcess}
        onSelectDestination={onSelectDestination}
      />,
    )
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.click(screen.getByTestId('process-dj-engineDj'))
    expect(onSelectDestination).toHaveBeenCalledWith(
      expect.objectContaining({ location: 'folder', appleMusic: true, engineDj: true }),
    )
    expect(onProcess).not.toHaveBeenCalled()
    expect(screen.getByTestId('process-dj-engineDj')).toBeInTheDocument()
  })

  it('marks the current location and the ticked DJ software', () => {
    render(
      <ExportButton
        {...baseProps}
        incomplete={false}
        destination={{ ...baseProps.destination, engineDj: true }}
      />,
    )
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    expect(screen.getByTestId('process-location-folder')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByTestId('process-location-beside')).not.toHaveAttribute('aria-current')
    expect(screen.getByTestId('process-dj-engineDj')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('process-dj-appleMusic')).toHaveAttribute('aria-checked', 'false')
  })

  it('disables Apple Music with the reason while FLAC is the picked format', () => {
    render(<ExportButton {...baseProps} incomplete={false} outputFormat="flac" />)
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    expect(screen.getByTestId('process-dj-appleMusic')).toBeDisabled()
    expect(screen.getByTestId('process-dj-appleMusic')).toHaveTextContent(
      i18n.t('editor.menuNoFlac'),
    )
    expect(screen.getByTestId('process-dj-engineDj')).toBeEnabled()
    expect(screen.getByTestId('process-location-beside')).toBeEnabled()
  })

  it('disables the libraries with the reason away from the output folder', () => {
    render(
      <ExportButton
        {...baseProps}
        incomplete={false}
        destination={{ ...baseProps.destination, location: 'beside' }}
      />,
    )
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    for (const id of ['process-dj-appleMusic', 'process-dj-engineDj']) {
      expect(screen.getByTestId(id)).toBeDisabled()
      expect(screen.getByTestId(id)).toHaveTextContent(i18n.t('editor.menuNeedsFolder'))
    }
  })

  it('offers no Apple Music off macOS', () => {
    render(<ExportButton {...baseProps} incomplete={false} mac={false} />)
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    expect(screen.queryByTestId('process-dj-appleMusic')).toBeNull()
    expect(screen.getByTestId('process-dj-engineDj')).toBeInTheDocument()
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
