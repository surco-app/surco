// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WaveformResult } from '../../../shared/types'
import { createQueryClient } from '../lib/queryClient'
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

const play = vi.fn()
const pause = vi.fn()
const audios: { onloadedmetadata: (() => void) | null; currentTime: number }[] = []

let client: QueryClient
beforeEach(() => {
  play.mockReset().mockResolvedValue(undefined)
  pause.mockReset()
  audios.length = 0
  // jsdom has no audio pipeline; the audition only needs seek/play/pause and the
  // loadedmetadata hook the component waits on before seeking.
  vi.stubGlobal(
    'Audio',
    class {
      onloadedmetadata: (() => void) | null = null
      ontimeupdate: (() => void) | null = null
      onended: (() => void) | null = null
      currentTime = 0
      play = play
      pause = pause
      constructor() {
        audios.push(this)
      }
    },
  )
  client = createQueryClient()
  ;(window as unknown as { api: unknown }).api = {
    waveform: vi.fn().mockResolvedValue(noisyEndsWave()),
    // The magnet's precision pass; null keeps tests on the coarse onsets.
    waveformWindow: vi.fn().mockResolvedValue(null),
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
  // The detection only suggests — nothing is staged until a scissors marker is
  // clicked, and each side stages alone, so "only the end" is one click. The
  // finding itself rides the header as a pill, the app's one convention for
  // analysis results (like the quality section's verdict).
  it('pills the detected silence and stages each side from its scissors marker', async () => {
    const onChange = vi.fn()
    render(section({ onChange }))
    const start = await screen.findByTestId('trim-apply-start', undefined, { timeout: 3000 })
    expect(screen.getByTestId('trim-detected-pill')).toHaveTextContent(
      '9.9 s from the start · 9.9 s from the end',
    )
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(start)
    expect(onChange).toHaveBeenCalledWith({ startSec: 9.9 })
    fireEvent.click(screen.getByTestId('trim-apply-end'))
    expect(onChange).toHaveBeenCalledWith({ endSec: 90.1 })
    // A suggestion hugging the track edge must keep its button reachable: the
    // center clamps a half-button inside the strip instead of clipping under
    // the edge handle.
    expect(screen.getByTestId('trim-apply-end').style.left).toContain('clamp(')
  })

  it('says there is nothing to cut when the track starts and ends on music', async () => {
    ;(window as unknown as { api: { waveform: unknown } }).api.waveform = vi
      .fn()
      .mockResolvedValue(musicOnlyWave())
    render(section())
    const detected = await screen.findByTestId('trim-detected', undefined, { timeout: 3000 })
    expect(detected).toHaveTextContent('No leading or trailing silence detected.')
    expect(screen.queryByTestId('trim-detected-pill')).not.toBeInTheDocument()
    expect(screen.queryByTestId('trim-apply-start')).not.toBeInTheDocument()
  })

  // The whole point of the section: it shows the two places a trim ever happens —
  // the head and the tail — already framed on the cut, so nobody has to zoom and
  // scrub a ten-minute track to reach a spot the detector already found.
  it('frames each lane on its own cut instead of showing the whole track', async () => {
    render(section({ value: { startSec: 9.7, endSec: 90.3 } }))
    // Default context is ±5 s, so the head lane spans 4.7–14.7 s and the tail
    // lane 85.3–95.3 s. The minutes in between are never drawn.
    expect(
      await screen.findByTestId('trim-lane-range-start', undefined, { timeout: 3000 }),
    ).toHaveTextContent('4.7–14.7 s')
    expect(screen.getByTestId('trim-lane-range-end')).toHaveTextContent('85.3–95.3 s')
    expect(screen.getByTestId('trim-lane-start')).toBeInTheDocument()
    expect(screen.getByTestId('trim-lane-end')).toBeInTheDocument()
  })

  // With no cut staged, the lanes frame what the DETECTOR found — so opening the
  // section already shows the silence it is telling you about.
  it('frames the lanes on the detected silence when nothing is staged yet', async () => {
    render(section())
    // The suggestion sits at the detector's own 9.9 s (the header pill rounds the
    // padded figure), and each lane frames ±5 s around it.
    expect(
      await screen.findByTestId('trim-lane-range-start', undefined, { timeout: 3000 }),
    ).toHaveTextContent('4.9–14.9 s')
    expect(screen.getByTestId('trim-lane-range-end')).toHaveTextContent('85.1–95.1 s')
  })

  // There is no scrolling here, so the old zoom becomes the one question two fixed
  // windows can still ask: how much track flanks the cut.
  it('widens and narrows the context around both cuts', async () => {
    render(section({ value: { startSec: 9.7, endSec: 90.3 } }))
    const context = await screen.findByTestId('trim-context', undefined, { timeout: 3000 })
    expect(context).toHaveTextContent('±5s')
    fireEvent.click(screen.getByTestId('waveform-zoom-out'))
    expect(screen.getByTestId('trim-context')).toHaveTextContent('±15s')
    // The lane follows: 9.7 s ± 15 s, clamped at the track's start.
    expect(screen.getByTestId('trim-lane-range-start')).toHaveTextContent('0.0–30.0 s')
    fireEvent.click(screen.getByTestId('waveform-zoom-in'))
    fireEvent.click(screen.getByTestId('waveform-zoom-in'))
    expect(screen.getByTestId('trim-context')).toHaveTextContent('±2s')
    expect(screen.getByTestId('trim-lane-range-start')).toHaveTextContent('7.7–11.7 s')
  })

  // A staged trim reads off the strip: shaded discard regions, the cuts readout,
  // and the reset that clears the whole range in one click.
  it('shades the staged cuts and clears them from the reset button', async () => {
    const onChange = vi.fn()
    render(section({ value: { startSec: 9.7, endSec: 90.3 }, onChange }))
    expect(
      await screen.findByTestId('trim-shade-start', undefined, { timeout: 3000 }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('trim-shade-end')).toBeInTheDocument()
    expect(screen.getByTestId('trim-cuts')).toHaveTextContent('9.7 s from the start')
    expect(screen.getByTestId('trim-cuts')).toHaveTextContent('9.7 s from the end')
    fireEvent.click(screen.getByTestId('trim-clear'))
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  // Dragging commits once on release (not per pixel), with the seconds read from
  // the handle's position across ITS LANE — the start lane is a window around the
  // cut (9.7 s ± the 5 s context), so 1000 px spans 4.7–14.7 s: 100 px is a second.
  it('commits a handle drag on release', async () => {
    const onChange = vi.fn()
    render(section({ value: { startSec: 9.7, endSec: 90.3 }, onChange }))
    const start = await screen.findByTestId('trim-handle-start', undefined, { timeout: 3000 })
    const overlay = screen.getByTestId('trim-overlay-start')
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
    fireEvent(start, new MouseEvent('pointerdown', { bubbles: true, clientX: 500 }))
    // 330 px into a 4.7–14.7 s window is 8.0 s.
    fireEvent(start, new MouseEvent('pointermove', { bubbles: true, clientX: 330 }))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent(start, new MouseEvent('pointerup', { bubbles: true }))
    expect(onChange).toHaveBeenCalledWith({ startSec: 8, endSec: 90.3 })
  })

  // The trackpad-haptics stand-in: dragging near where the music actually starts
  // pulls the handle onto it (the onset, not the padded suggestion) and the handle
  // glows while caught — landing the cut "at the wave" without pixel-hunting.
  it('snaps a dragged handle onto the music onset and glows', async () => {
    const onChange = vi.fn()
    render(section({ value: { startSec: 9.7, endSec: 90.3 }, onChange }))
    const start = await screen.findByTestId('trim-handle-start', undefined, { timeout: 3000 })
    const overlay = screen.getByTestId('trim-overlay-start')
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
    fireEvent(start, new MouseEvent('pointerdown', { bubbles: true, clientX: 500 }))
    // 528 px is 9.98 s — inside the magnet's catch of the onset at 10.0 s.
    fireEvent(start, new MouseEvent('pointermove', { bubbles: true, clientX: 528 }))
    expect(screen.getByTestId('trim-snapped-start')).toBeInTheDocument()
    fireEvent(start, new MouseEvent('pointerup', { bubbles: true }))
    expect(onChange).toHaveBeenCalledWith({ startSec: 10, endSec: 90.3 })
  })

  // Placing a cut is one gesture: pressing anywhere in a lane drops THAT lane's
  // handle under the pointer, and releasing commits — no drag needed. Each lane
  // owns one bound, so a press can never move the wrong one.
  it('places a lane\'s cut where the wave is pressed', async () => {
    const onChange = vi.fn()
    render(section({ value: { startSec: 9.7, endSec: 90.3 }, onChange }))
    const overlay = await screen.findByTestId('trim-overlay-start', undefined, { timeout: 3000 })
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
    // 130 px into the 4.7–14.7 s window is 6.0 s.
    fireEvent(overlay, new MouseEvent('pointerdown', { bubbles: true, clientX: 130 }))
    fireEvent(overlay, new MouseEvent('pointerup', { bubbles: true }))
    expect(onChange).toHaveBeenCalledWith({ startSec: 6, endSec: 90.3 })
  })

  // Parking the start handle back on the left edge means "cut nothing here": the
  // bound drops rather than persisting a hair's-width trim.
  it('drops a bound dragged back to its own edge', async () => {
    const onChange = vi.fn()
    render(section({ value: { startSec: 9.7 }, onChange }))
    const start = await screen.findByTestId('trim-handle-start', undefined, { timeout: 3000 })
    const overlay = screen.getByTestId('trim-overlay-start')
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
    fireEvent(start, new MouseEvent('pointerdown', { bubbles: true, clientX: 500 }))
    // The lane's left edge is 4.7 s, so dragging past it clamps to the track's
    // own start — a bound that cuts nothing, which must drop entirely.
    fireEvent(start, new MouseEvent('pointermove', { bubbles: true, clientX: -600 }))
    fireEvent(start, new MouseEvent('pointerup', { bubbles: true }))
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  // The by-ear check: the start audition must open exactly at the cut-in — what
  // the converted file will start with — and a second click stops it.
  it('auditions the track from the cut-in and stops on a second click', async () => {
    render(section({ value: { startSec: 9.7, endSec: 90.3 } }))
    const btn = await screen.findByTestId('trim-audition-start', undefined, { timeout: 3000 })
    fireEvent.click(btn)
    const audio = audios.at(-1)
    expect(audio).toBeDefined()
    act(() => audio?.onloadedmetadata?.())
    expect(audio?.currentTime).toBe(9.7)
    expect(play).toHaveBeenCalledOnce()
    fireEvent.click(btn)
    expect(pause).toHaveBeenCalledOnce()
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
