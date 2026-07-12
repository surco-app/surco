// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WaveformResult } from '../../../shared/types'
import '../i18n'
import { TrimSection } from './TrimSection'

afterEach(cleanup)

// 100 s track with 10 s of surface noise on each side of the music: the detector
// (pad 0.3 s) should suggest cutting ~9.7 s from the start and ~9.7 s from the end.
function noisyEndsWave(): WaveformResult {
  return {
    peaks: Array.from({ length: 200 }, (_, i) => (i >= 20 && i < 180 ? 0.3 : 0.0005)),
    durationSec: 100,
  }
}

function musicOnlyWave(): WaveformResult {
  return { peaks: Array.from({ length: 200 }, () => 0.3), durationSec: 100 }
}

let client: QueryClient
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  ;(window as unknown as { api: unknown }).api = {
    waveform: vi.fn().mockResolvedValue(noisyEndsWave()),
  }
})

function section(over: Partial<React.ComponentProps<typeof TrimSection>> = {}): React.JSX.Element {
  return (
    <QueryClientProvider client={client}>
      <TrimSection
        value={undefined}
        open
        onToggle={() => {}}
        onChange={() => {}}
        inputPath="/in/track.wav"
        {...over}
      />
    </QueryClientProvider>
  )
}

describe('TrimSection', () => {
  // The detection only suggests — nothing is staged until the user confirms, so a
  // track never gets silently trimmed just by opening the section.
  it('suggests the detected silence and stages it only on the apply click', async () => {
    const onChange = vi.fn()
    render(section({ onChange }))
    const apply = await screen.findByTestId('trim-apply', undefined, { timeout: 3000 })
    expect(screen.getByTestId('trim-detected')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(apply)
    expect(onChange).toHaveBeenCalledWith({ startSec: 9.7, endSec: 90.3 })
  })

  it('says there is nothing to cut when the track starts and ends on music', async () => {
    ;(window as unknown as { api: { waveform: unknown } }).api.waveform = vi
      .fn()
      .mockResolvedValue(musicOnlyWave())
    render(section())
    const detected = await screen.findByTestId('trim-detected', undefined, { timeout: 3000 })
    expect(detected).toHaveTextContent('No leading or trailing silence detected.')
    expect(screen.queryByTestId('trim-apply')).not.toBeInTheDocument()
  })

  // A staged trim reads off the strip: shaded discard regions, the cuts readout,
  // and the reset that clears the whole range in one click.
  it('shades the staged cuts and clears them from the reset button', async () => {
    const onChange = vi.fn()
    render(section({ value: { startSec: 9.7, endSec: 90.3 }, onChange }))
    expect(await screen.findByTestId('trim-shade-start', undefined, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByTestId('trim-shade-end')).toBeInTheDocument()
    expect(screen.getByTestId('trim-cuts')).toHaveTextContent('9.7 s from the start')
    expect(screen.getByTestId('trim-cuts')).toHaveTextContent('9.7 s from the end')
    fireEvent.click(screen.getByTestId('trim-clear'))
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  // Dragging commits once on release (not per pixel), with the seconds read from
  // the handle's position across the strip.
  it('commits a handle drag on release', async () => {
    const onChange = vi.fn()
    render(section({ value: { startSec: 9.7, endSec: 90.3 }, onChange }))
    const start = await screen.findByTestId('trim-handle-start', undefined, { timeout: 3000 })
    const overlay = start.parentElement as HTMLElement
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 1000,
      top: 0,
      height: 64,
      right: 1000,
      bottom: 64,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)
    // jsdom has no PointerEvent, and the plain-Event fallback drops clientX; a
    // MouseEvent with the pointer type carries the coordinate React reads.
    fireEvent(start, new MouseEvent('pointerdown', { bubbles: true, clientX: 97 }))
    fireEvent(start, new MouseEvent('pointermove', { bubbles: true, clientX: 50 }))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent(start, new MouseEvent('pointerup', { bubbles: true }))
    expect(onChange).toHaveBeenCalledWith({ startSec: 5, endSec: 90.3 })
  })

  // Parking the start handle back on the left edge means "cut nothing here": the
  // bound drops rather than persisting a hair's-width trim.
  it('drops a bound dragged back to its own edge', async () => {
    const onChange = vi.fn()
    render(section({ value: { startSec: 9.7 }, onChange }))
    const start = await screen.findByTestId('trim-handle-start', undefined, { timeout: 3000 })
    const overlay = start.parentElement as HTMLElement
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 1000,
      top: 0,
      height: 64,
      right: 1000,
      bottom: 64,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)
    fireEvent(start, new MouseEvent('pointerdown', { bubbles: true, clientX: 97 }))
    fireEvent(start, new MouseEvent('pointermove', { bubbles: true, clientX: 0 }))
    fireEvent(start, new MouseEvent('pointerup', { bubbles: true }))
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  // The arrows give the precision a drag on the coarse strip can't: tenths of a
  // second, a whole second with Shift.
  it('nudges the focused handle with the arrow keys', async () => {
    const onChange = vi.fn()
    render(section({ value: { startSec: 9.7, endSec: 90.3 }, onChange }))
    const start = await screen.findByTestId('trim-handle-start', undefined, { timeout: 3000 })
    fireEvent.keyDown(start, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith({ startSec: 9.8, endSec: 90.3 })
    fireEvent.keyDown(start, { key: 'ArrowLeft', shiftKey: true })
    expect(onChange).toHaveBeenCalledWith({ startSec: 8.7, endSec: 90.3 })
  })

  // Folded with a staged trim, the header badges the total cut, like the
  // click-repair badge; without one the summary states "Off" instead.
  it('badges the total cut only while folded and active', async () => {
    const { rerender } = render(section({ value: { startSec: 9.7, endSec: 90.3 }, open: false }))
    expect(screen.getByTestId('trim-active-badge')).toBeInTheDocument()
    rerender(section({ value: undefined, open: false }))
    expect(screen.queryByTestId('trim-active-badge')).not.toBeInTheDocument()
    expect(screen.getByTestId('trim-summary')).toHaveTextContent('Off')
  })
})
