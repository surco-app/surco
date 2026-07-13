// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BeatgridResult, WaveformResult } from '../../../shared/types'
import { createQueryClient } from '../lib/queryClient'
import '../i18n'
import { GridSection } from './GridSection'

afterEach(cleanup)

const detected: BeatgridResult = {
  bpm: 120,
  confidence: 0.9,
  anchorSec: 0.25,
  phaseAmbiguity: 0.1,
  phaseMargin: 5,
}

function wave(): WaveformResult {
  return { peaks: Array.from({ length: 200 }, () => 0.3), durationSec: 60 }
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
  // jsdom has no 2D canvas context; the draw helper already handles null.
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => null,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext
  // jsdom implements no PointerEvent either; aliasing it to MouseEvent lets
  // fireEvent carry clientX into the drag handlers (same trick as
  // WaveformCompare.test) — without it clientX arrives undefined and the drag
  // math turns NaN.
  ;(window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = window.MouseEvent
  client = createQueryClient()
  ;(window as unknown as { api: unknown }).api = {
    beatgrid: vi.fn().mockResolvedValue(detected),
    waveform: vi.fn().mockResolvedValue(wave()),
    // The working lane opens past the hi-res threshold now, so its windowed
    // re-decode fires on mount; null keeps it on the stretched overview.
    waveformWindow: vi.fn().mockResolvedValue(null),
  }
})

afterEach(() => vi.unstubAllGlobals())

function section(over: Partial<React.ComponentProps<typeof GridSection>> = {}): React.JSX.Element {
  return (
    <QueryClientProvider client={client}>
      <GridSection
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

// Real strips are hundreds of px wide; jsdom rects are 0×0, which would land
// every press "on" a line. A fixed rect gives the grab tests real geometry:
// 6000 px over 60 s → a beat every 50 px at 120 BPM.
function stubOverlayRect(): void {
  HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 6000,
    bottom: 100,
    width: 6000,
    height: 100,
    toJSON: () => ({}),
  })) as unknown as typeof HTMLElement.prototype.getBoundingClientRect
}

describe('GridSection header', () => {
  // The detection's finding rides the header as a pill, the app's one convention
  // for analysis results — readable without opening the section.
  it('pills the detected tempo once the analysis lands', async () => {
    render(section())
    const pill = await screen.findByTestId('grid-detected-pill', undefined, { timeout: 3000 })
    expect(pill).toHaveTextContent('Detected 120.0 BPM')
  })

  // A user-confirmed grid outranks the suggestion: the folded header wears it as
  // the accent badge, same semantics as the trim's active cut badge.
  it('wears a staged grid as the folded active badge', () => {
    render(section({ value: { bpm: 127.5, anchorSec: 0.1 }, open: false }))
    expect(screen.getByTestId('grid-active-badge')).toHaveTextContent('127.50 BPM')
    expect(screen.queryByTestId('grid-detected-pill')).not.toBeInTheDocument()
  })

  // A coin-flip detection (the "grid to review" fact) must be readable here in
  // context, not only in the list filter — warn tint instead of the quiet pill.
  it('wears the review pill when the detection was a coin flip', async () => {
    ;(window as unknown as { api: { beatgrid: unknown } }).api.beatgrid = vi
      .fn()
      .mockResolvedValue({ ...detected, phaseAmbiguity: 1, phaseMargin: 1 })
    render(section())
    const pill = await screen.findByTestId('grid-review-pill', undefined, { timeout: 3000 })
    expect(pill).toHaveTextContent('Check the grid by ear')
    expect(screen.queryByTestId('grid-detected-pill')).not.toBeInTheDocument()
  })

  // Beatless material measures null: the section must say so instead of leaving
  // an empty body that reads as a broken analysis.
  it('says when no steady beat was found', async () => {
    ;(window as unknown as { api: { beatgrid: unknown } }).api.beatgrid = vi
      .fn()
      .mockResolvedValue(null)
    render(section())
    const nothing = await screen.findByTestId('grid-nothing', undefined, { timeout: 3000 })
    expect(nothing).toHaveTextContent('No steady beat detected.')
  })

  // The detection decodes minutes of audio; a folded section must not pay for it.
  it('does not analyse while folded', async () => {
    const probe = vi.fn().mockResolvedValue(detected)
    ;(window as unknown as { api: { beatgrid: unknown } }).api.beatgrid = probe
    render(section({ open: false }))
    await new Promise((r) => setTimeout(r, 1200))
    expect(probe).not.toHaveBeenCalled()
  })
})

describe('GridSection grid', () => {
  // The detected grid shows live before anything is staged. At overview zoom a
  // 60 s track's 120 beats pass the thinning cap, so only whole bars render —
  // sparse ruler ticks phased to the anchor, not an amber wall over the wave.
  it('draws the detected grid as bar ticks phased to the anchor', async () => {
    render(section())
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    const downbeats = screen.getAllByTestId('grid-line-downbeat')
    expect(downbeats).toHaveLength(30)
    expect(screen.queryAllByTestId('grid-line')).toHaveLength(0)
    expect(downbeats[0].style.left).toBe(`${(0.25 / 60) * 100}%`)
  })

  it('nudges the grid earlier and later by 10 ms', async () => {
    const onChange = vi.fn()
    render(section({ onChange }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    fireEvent.click(screen.getByTestId('grid-nudge-earlier'))
    expect(onChange).toHaveBeenCalledWith({ bpm: 120, anchorSec: 0.24 })
    fireEvent.click(screen.getByTestId('grid-nudge-later'))
    expect(onChange).toHaveBeenCalledWith({ bpm: 120, anchorSec: 0.26 })
  })

  // Shifting by a whole beat re-phases the downbeat count without moving any
  // line — how a grid whose bar-1 landed on the wrong beat gets fixed.
  it('shifts the anchor by one beat from the beat buttons', async () => {
    const onChange = vi.fn()
    render(section({ onChange }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    fireEvent.click(screen.getByTestId('grid-beat-forward'))
    expect(onChange).toHaveBeenCalledWith({ bpm: 120, anchorSec: 0.75 })
  })

  // Half/double-time is tempo detection's inherent ambiguity; fixing it must be
  // one click, not retyping.
  it('halves and doubles the BPM around the same anchor', async () => {
    const onChange = vi.fn()
    render(section({ onChange }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    fireEvent.click(screen.getByTestId('grid-bpm-half'))
    expect(onChange).toHaveBeenCalledWith({ bpm: 60, anchorSec: 0.25 })
    fireEvent.click(screen.getByTestId('grid-bpm-double'))
    expect(onChange).toHaveBeenCalledWith({ bpm: 240, anchorSec: 0.25 })
  })

  it('commits a typed BPM on Enter and ignores garbage', async () => {
    const onChange = vi.fn()
    render(section({ onChange }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    const input = screen.getByTestId('grid-bpm-input')
    fireEvent.change(input, { target: { value: '130' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith({ bpm: 130, anchorSec: 0.25 })
    onChange.mockClear()
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })

  // A BPM the grid can't use (out of any deck's range) must not stage: the
  // normalize guard is the same one that repairs session.json.
  it('rejects an out-of-range typed BPM', async () => {
    const onChange = vi.fn()
    render(section({ onChange }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    const input = screen.getByTestId('grid-bpm-input')
    fireEvent.change(input, { target: { value: '4' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })

  // "Auto" is the re-run-the-machine button: it drops whatever was staged AND
  // redoes the analysis bypassing the cache — a stale verdict from an older
  // detector must not be what "see if it fixes itself" returns.
  it('resets to a FRESH detection from the Auto button', async () => {
    const onChange = vi.fn()
    const probe = vi.fn().mockResolvedValue(detected)
    ;(window as unknown as { api: { beatgrid: unknown } }).api.beatgrid = probe
    render(section({ value: { bpm: 128, anchorSec: 0.5 }, onChange }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    fireEvent.click(screen.getByTestId('grid-reset'))
    expect(onChange).toHaveBeenCalledWith(undefined)
    await waitFor(() => expect(probe).toHaveBeenCalledWith('/in/track.wav', true))
  })

  // The flagged-for-review flow: nothing is staged, the user just wants the
  // detection redone — the button must be there without touching the grid first.
  it('offers Auto on a bare detection too', async () => {
    const probe = vi.fn().mockResolvedValue(detected)
    ;(window as unknown as { api: { beatgrid: unknown } }).api.beatgrid = probe
    render(section())
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    fireEvent.click(screen.getByTestId('grid-reset'))
    await waitFor(() => expect(probe).toHaveBeenCalledWith('/in/track.wav', true))
  })

  // Grabbing a beat line and dragging slides the whole grid — the rekordbox
  // gesture — and commits once, on release.
  it('slides the phase by dragging a beat line', async () => {
    const onChange = vi.fn()
    stubOverlayRect()
    render(section({ onChange }))
    const overlay = await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    // At 100 px/s the 0.25 s beat sits at 25 px; press on it, drag one beat (50 px) right.
    fireEvent.pointerDown(overlay, { clientX: 25, pointerId: 1 })
    fireEvent.pointerMove(overlay, { clientX: 75, pointerId: 1 })
    fireEvent.pointerUp(overlay, { pointerId: 1 })
    expect(onChange).toHaveBeenCalledTimes(1)
    const grid = onChange.mock.calls[0][0]
    expect(grid.bpm).toBe(120)
    expect(grid.anchorSec).toBeCloseTo(0.75, 2)
  })

  // A press on empty wave must stay inert: dragging there used to shift the
  // phase, so panning or a stray click while zooming moved the grid unnoticed.
  it('ignores presses away from any beat line', async () => {
    const onChange = vi.fn()
    stubOverlayRect()
    render(section({ onChange }))
    const overlay = await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    // 50 px sits 25 px from the beats at 25 and 75 px — well past the grab radius.
    fireEvent.pointerDown(overlay, { clientX: 50, pointerId: 1 })
    fireEvent.pointerMove(overlay, { clientX: 110, pointerId: 1 })
    fireEvent.pointerUp(overlay, { pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
  })

  // Trackpad clicks wobble a pixel or two; that wobble must not commit a
  // milliseconds-off grid on every click near a line.
  it('does not commit a sub-threshold wobble on a beat line', async () => {
    const onChange = vi.fn()
    stubOverlayRect()
    render(section({ onChange }))
    const overlay = await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    fireEvent.pointerDown(overlay, { clientX: 25, pointerId: 1 })
    fireEvent.pointerMove(overlay, { clientX: 26, pointerId: 1 })
    fireEvent.pointerUp(overlay, { pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
  })

  // The audition must start ON a beat: hearing the click land on the transient
  // is the whole check, so it seeks to the first grid beat in view.
  it('auditions from the first beat of the visible window', async () => {
    render(section())
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    fireEvent.click(screen.getByTestId('grid-audition'))
    expect(audios).toHaveLength(1)
    audios[0].onloadedmetadata?.()
    expect(audios[0].currentTime).toBeCloseTo(0.25, 6)
    expect(play).toHaveBeenCalled()
  })
})

// The rekordbox-style two-lane layout, by user feedback: working the grid in
// one strip meant zooming in from ×1 on every track and crawling along a tiny
// scrollbar. A slim overview lane under the working strip always shows the
// whole track and navigates with one press or scrub; the working lane above is
// where grid work happens, so it opens at working depth, not at the overview.
describe('GridSection two-lane layout', () => {
  it('opens with an overview lane and the working lane pre-zoomed', async () => {
    render(section())
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    expect(screen.getByTestId('grid-overview')).toBeInTheDocument()
    expect(screen.getByTestId('waveform-zoom-reset')).toHaveTextContent('×32')
    expect(screen.getByTestId('grid-overview-window')).toBeInTheDocument()
  })

  it('centers the working window where the overview is pressed', async () => {
    stubOverlayRect()
    render(section())
    const overview = await screen.findByTestId('grid-overview', undefined, { timeout: 3000 })
    const scroller = screen.getByTestId('waveform-scroller')
    Object.defineProperty(scroller, 'scrollWidth', { value: 6000, configurable: true })
    Object.defineProperty(scroller, 'clientWidth', { value: 600, configurable: true })
    fireEvent.pointerDown(overview, { clientX: 3000, pointerId: 1 })
    expect(scroller.scrollLeft).toBe(2700)
    // Still held: scrubbing to the end clamps to the last full window.
    fireEvent.pointerMove(overview, { clientX: 6000, pointerId: 1 })
    expect(scroller.scrollLeft).toBe(5400)
    fireEvent.pointerUp(overview, { pointerId: 1 })
  })

  // A hover without a press must not move the window the user is working in.
  it('ignores overview moves without a press', async () => {
    stubOverlayRect()
    render(section())
    const overview = await screen.findByTestId('grid-overview', undefined, { timeout: 3000 })
    const scroller = screen.getByTestId('waveform-scroller')
    Object.defineProperty(scroller, 'scrollWidth', { value: 6000, configurable: true })
    Object.defineProperty(scroller, 'clientWidth', { value: 600, configurable: true })
    fireEvent.pointerMove(overview, { clientX: 3000, pointerId: 1 })
    expect(scroller.scrollLeft).toBe(0)
  })
})

