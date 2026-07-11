// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
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
  el.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 10, bubbles: true }))
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
      'aria-current',
      'true',
    )
    expect(screen.getByTestId('process-destination-folder')).not.toHaveAttribute('aria-current')
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
    render(<ExportButton {...baseProps} incomplete={false} status="processing" stage="appleMusic" />)
    const btn = screen.getByTestId('process-btn')
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent('Adding to Apple Music…')
    expect(screen.getByTestId('process-progress')).toHaveStyle({ width: '85%' })
  })

  it('names the picked format in the converting stage label', () => {
    render(<ExportButton {...baseProps} incomplete={false} status="processing" stage="converting" />)
    expect(screen.getByTestId('process-btn')).toHaveTextContent('Converting to AIFF…')
    const width = screen.getByTestId('process-progress').style.width
    expect(Number.parseFloat(width)).toBeCloseTo(55)
  })

  // The first progress event may not have landed yet: no stage, no fill — the
  // button falls back to the generic processing label instead of an empty bar.
  it('falls back to the plain processing label before the first stage lands', () => {
    render(<ExportButton {...baseProps} incomplete={false} status="processing" />)
    expect(screen.getByTestId('process-btn')).toHaveTextContent('Processing…')
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
})
