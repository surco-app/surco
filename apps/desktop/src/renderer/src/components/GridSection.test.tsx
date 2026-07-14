// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { Profiler, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Beatgrid, BeatgridResult, WaveformResult } from '../../../shared/types'
import { createQueryClient } from '../lib/queryClient'
import '../i18n'
import { runKeyClaim } from '../lib/spaceClaim'
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

  // Nudging past zero has to keep walking the grid LEFT. The anchor is a phase,
  // so folding a negative one by a whole beat describes the same lattice — but
  // on screen every line jumps a beat to the RIGHT, which reads as the grid
  // snapping back to where it started. Whoever is nudging is watching one line
  // against one transient: it must keep creeping the way they pressed.
  it('keeps walking the grid earlier when a nudge crosses zero', async () => {
    const onChange = vi.fn()
    render(section({ onChange, value: { bpm: 120, anchorSec: 0.005 } }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    fireEvent.click(screen.getByTestId('grid-nudge-earlier'))
    expect(onChange).toHaveBeenCalledWith({ bpm: 120, anchorSec: -0.005 })
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

  // The grid moves by buttons and keyboard alone (user call): no pointer gesture
  // on the lane may ever shift the phase — a press just pans the wave.
  it('never moves the grid from a pointer drag on the lane', async () => {
    const onChange = vi.fn()
    stubOverlayRect()
    render(section({ onChange }))
    const overlay = await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    // Straight over the beat at 0.25 s (x=25 at 100 px/s) — the old grab spot.
    fireEvent.pointerDown(overlay, { clientX: 25, pointerId: 1 })
    fireEvent.pointerMove(overlay, { clientX: 75, pointerId: 1 })
    fireEvent.pointerUp(overlay, { pointerId: 1 })
    // And over open wave.
    fireEvent.pointerDown(overlay, { clientX: 50, pointerId: 1 })
    fireEvent.pointerMove(overlay, { clientX: 110, pointerId: 1 })
    fireEvent.pointerUp(overlay, { pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
  })

  // The audition must start ON a beat: hearing the click land on the transient
  // is the whole check, so it seeks to the first grid beat in view.
  // The red line IS the position, so the check plays the stretch being worked
  // on — and Space drives it while the section is open (without the mini-player
  // hearing the same press: see the spaceClaim guard in useKeyboardShortcuts).
  it('auditions from the centre reference and toggles on Space', async () => {
    render(section())
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    fireEvent.click(screen.getByTestId('grid-audition'))
    expect(audios).toHaveLength(1)
    audios[0].onloadedmetadata?.()
    // Initial full-track view: the centre is 30 s, magnetised onto the 30.25 s
    // beat (120 bpm phased to 0.25 s) — a beat, not an arbitrary instant.
    expect(audios[0].currentTime).toBeCloseTo(30.25, 2)
    expect(play).toHaveBeenCalled()
    // The section's Space claim stops it again.
    expect(runKeyClaim('play')).toBe(true)
    expect(pause).toHaveBeenCalled()
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

  // "Hear the grid" must behave like a player: the wave scrolls along under the
  // advancing playhead instead of playing off-screen once it leaves the window.
  it('keeps the working window on the audition playhead', async () => {
    const rafCbs: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCbs.push(cb)
      return rafCbs.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    stubOverlayRect()
    render(section())
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    const scroller = screen.getByTestId('waveform-scroller')
    Object.defineProperty(scroller, 'scrollWidth', { value: 6000, configurable: true })
    Object.defineProperty(scroller, 'clientWidth', { value: 600, configurable: true })
    fireEvent.click(screen.getByTestId('grid-audition'))
    audios[0].onloadedmetadata?.()
    audios[0].currentTime = 30
    rafCbs.shift()?.(0)
    // 30 s into a 60 s track, centered: 0.5 × 6000 − 300.
    expect(scroller.scrollLeft).toBe(2700)
  })

  // The playhead moves by writing its own style, not by re-rendering the section.
  //
  // The audition is the one moment the user judges beat alignment BY EYE, so a dropped
  // frame here defeats the feature's whole purpose — and it used to drop them: the playhead
  // sat in React state, so every animation frame re-rendered all 1300 lines of this
  // component (recomputing the grid lines, the snapped centre, the active segment, and
  // reconciling dozens of line spans at ×32 zoom). Worse, the follow-scroll it also does
  // makes the Strip report a new view, which re-rendered the section a SECOND time per
  // frame. Two elements move; nothing else needs to.
  it('moves the playhead without re-rendering the section', async () => {
    const rafCbs: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCbs.push(cb)
      return rafCbs.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    stubOverlayRect()
    // Count the section's renders for real. Asserting on the resulting DOM would prove
    // nothing: a re-render produces byte-identical markup, so the cost is invisible from the
    // outside — which is exactly why it went unnoticed. React's Profiler reports every
    // commit the subtree makes, which is the thing that must not happen per frame.
    const commits: string[] = []

    render(
      <Profiler id="grid" onRender={(_id, phase) => commits.push(phase)}>
        {section()}
      </Profiler>,
    )
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    fireEvent.click(screen.getByTestId('grid-audition'))
    audios[0].onloadedmetadata?.()
    commits.length = 0

    // act() so anything the frame enqueues is flushed before we look — otherwise a state
    // write inside the rAF would sit pending and the commit would go uncounted, which is
    // how a test like this quietly stops testing anything.
    act(() => {
      audios[0].currentTime = 15
      rafCbs.shift()?.(0)
    })

    // The playhead moved, and its overview twin with it…
    expect(screen.getByTestId('grid-playhead').style.left).toBe(`${(15 / 60) * 100}%`)
    expect(screen.getByTestId('grid-overview-playhead').style.left).toBe(`${(15 / 60) * 100}%`)
    // …and the frame cost React nothing: not one commit.
    expect(commits).toEqual([])
  })

  // Scrubbing the overview churns through windows faster than ffmpeg can decode
  // them; every mid-scrub window used to enqueue anyway, and the queue then
  // played catch-up for seconds after release. The re-decode must wait for the
  // view to rest.
  it('defers the deep-zoom re-decode until the view rests', async () => {
    const waveformWindow = vi.fn().mockResolvedValue(null)
    ;(window as unknown as { api: { waveformWindow: unknown } }).api.waveformWindow =
      waveformWindow
    render(section())
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    expect(waveformWindow).not.toHaveBeenCalled()
    await waitFor(() => expect(waveformWindow).toHaveBeenCalled(), { timeout: 2000 })
  })
})

// Djotas's rekordbox flow, simplified: a rip that drifts gets pinned back with
// "Adjust from here" — a new segment from the beat in view — and every later
// edit touches only the segment you're standing on, never what's behind it.
describe('GridSection segments', () => {
  // The button carves the segment at the beat AHEAD of the line, so the line must
  // land ON it — left where it was (a hair behind the new anchor) the controls
  // would still point at the segment BEHIND, and a nudge would move the whole
  // track instead of the stretch just carved out.
  it('lands the reference on the change it just staged', async () => {
    const onChange = vi.fn()
    stubOverlayRect()
    render(section({ onChange, value: { bpm: 120, anchorSec: 0.25 } }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    const scroller = screen.getByTestId('waveform-scroller')
    Object.defineProperty(scroller, 'scrollWidth', { value: 6000, configurable: true })
    Object.defineProperty(scroller, 'clientWidth', { value: 600, configurable: true })
    fireEvent.click(screen.getByTestId('grid-from-here'))
    const staged = onChange.mock.calls[0][0].changes[0].anchorSec
    expect(scroller.scrollLeft).toBeCloseTo((staged / 60) * 6000 - 300, 0)
  })

  // The real-world path: the user never touched the grid, so the section is
  // showing the DETECTION (value is undefined). Adjust-from-here must still
  // carve the segment — the bug was that it staged nothing here, so the later
  // nudges fell through to the base and moved the whole track.
  it('stages the change from a detected (never-touched) grid too', async () => {
    const onChange = vi.fn()
    stubOverlayRect()
    render(section({ onChange, value: undefined }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    fireEvent.click(screen.getByTestId('grid-from-here'))
    expect(onChange).toHaveBeenCalledTimes(1)
    const grid = onChange.mock.calls[0][0]
    expect(grid.changes).toHaveLength(1)
    expect(grid.changes[0].anchorSec).toBeCloseTo(30.25, 2)
  })

  // The heart of the complaint ("it moves the grid BEFORE the line, not after"):
  // right after carving the segment, a nudge must move THAT segment's anchor and
  // leave the base — everything to the left of the line — exactly where it was.
  it('nudges the new segment, not the base, right after adjusting from here', async () => {
    const onChange = vi.fn()
    stubOverlayRect()
    const { rerender } = render(section({ onChange, value: undefined }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    const scroller = screen.getByTestId('waveform-scroller')
    Object.defineProperty(scroller, 'scrollWidth', { value: 6000, configurable: true })
    Object.defineProperty(scroller, 'clientWidth', { value: 600, configurable: true })

    fireEvent.click(screen.getByTestId('grid-from-here'))
    const staged = onChange.mock.calls[0][0]
    expect(staged.changes).toHaveLength(1)
    // The app feeds the committed grid back in as `value` — that's the state the
    // next click acts on.
    rerender(section({ onChange, value: staged }))
    onChange.mockClear()

    fireEvent.click(screen.getByTestId('grid-nudge-later'))
    const nudged = onChange.mock.calls[0][0]
    // The base anchor — the grid behind the line — must NOT have moved.
    expect(nudged.anchorSec).toBeCloseTo(staged.anchorSec, 6)
    // The new segment's anchor is the one that moved.
    expect(nudged.changes[0].anchorSec).toBeCloseTo(staged.changes[0].anchorSec + 0.01, 4)
  })

  // Change anchors are stored rounded to the millisecond, but the magnet parks
  // the reference on the UNROUNDED beat — which can sit a few microseconds
  // before the anchor it is visually on. Compared exactly, that near-miss put
  // the controls on the BASE segment, and the nudge moved the grid LEFT of the
  // line (the user's "adjust from here moves the part before the red line").
  it('targets the segment under the line even when its anchor rounded past the beat', async () => {
    const onChange = vi.fn()
    stubOverlayRect()
    render(
      section({
        onChange,
        value: { bpm: 120, anchorSec: 0, changes: [{ anchorSec: 30.0004, bpm: 120 }] },
      }),
    )
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    fireEvent.click(screen.getByTestId('grid-nudge-later'))
    const nudged = onChange.mock.calls[0][0]
    expect(nudged.anchorSec).toBe(0)
    // commit rounds anchors to the millisecond, so the nudge lands on 30.010.
    expect(nudged.changes[0].anchorSec).toBeCloseTo(30.01, 3)
  })

  // After a nudge moves a change's anchor, the previous segment still has a
  // beat at the anchor's OLD spot — often closer to the line than the moved
  // diamond. The magnet used to grab that leftover beat and silently flip the
  // controls onto the base, so the SECOND nudge moved the grid left of the line.
  // Anchors outrank plain beats inside the catch window, so consecutive nudges
  // keep working the same segment.
  it('keeps consecutive nudges on the segment being edited', async () => {
    const onChange = vi.fn()
    stubOverlayRect()
    const first = { bpm: 120, anchorSec: 0, changes: [{ anchorSec: 30.01, bpm: 120 }] }
    // The line sits at 30.0 — exactly the base beat the change was carved from,
    // one nudge behind the diamond at 30.01.
    const { rerender } = render(section({ onChange, value: first }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    fireEvent.click(screen.getByTestId('grid-nudge-later'))
    const nudged = onChange.mock.calls[0][0]
    expect(nudged.anchorSec).toBe(0)
    expect(nudged.changes[0].anchorSec).toBeCloseTo(30.02, 3)
    rerender(section({ onChange, value: nudged }))
    onChange.mockClear()
    fireEvent.click(screen.getByTestId('grid-nudge-later'))
    const again = onChange.mock.calls[0][0]
    expect(again.anchorSec).toBe(0)
    expect(again.changes[0].anchorSec).toBeCloseTo(30.03, 3)
  })

  // rekordbox's TAP: four taps half a second apart read as 120 BPM on the
  // active segment. A long pause must start a fresh take, not poison the mean.
  it('sets the BPM from tapped intervals', async () => {
    const onChange = vi.fn()
    let clock = 0
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock)
    stubOverlayRect()
    render(section({ onChange, value: { bpm: 100, anchorSec: 0.25 } }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    const tap = screen.getByTestId('grid-tap')
    for (const t of [0, 500, 1000, 1500]) {
      clock = t
      fireEvent.click(tap)
    }
    const grid = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    expect(grid.bpm).toBeCloseTo(120, 2)
    // Three seconds of silence, then two taps at a new tempo: only the fresh
    // pair counts.
    onChange.mockClear()
    for (const t of [4500, 5100]) {
      clock = t
      fireEvent.click(tap)
    }
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][0].bpm).toBeCloseTo(100, 2)
    now.mockRestore()
  })

  // rekordbox's expand/shrink beat intervals: a fine tempo step — wider gaps
  // between beats IS a lower BPM — pivoting at the segment's anchor.
  it('expands and shrinks the beat intervals by a hundredth of a BPM', async () => {
    const onChange = vi.fn()
    stubOverlayRect()
    render(section({ onChange, value: { bpm: 120, anchorSec: 0.25 } }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    fireEvent.click(screen.getByTestId('grid-expand'))
    expect(onChange.mock.calls[0][0].bpm).toBeCloseTo(119.99, 3)
    fireEvent.click(screen.getByTestId('grid-shrink'))
    expect(onChange.mock.calls[1][0].bpm).toBeCloseTo(120.01, 3)
    expect(onChange.mock.calls[1][0].anchorSec).toBe(0.25)
  })

  // rekordbox's "set the first beat to the current position": the base re-phases
  // so a beat lands exactly under the line — folded back to keep the first beat
  // near the start. Uses the RAW centre: the snapped centre is already a beat.
  it('re-phases the grid so a beat lands under the line', async () => {
    const onChange = vi.fn()
    stubOverlayRect()
    // Anchor 0.3 puts the lattice 0.2 s off the view centre (30 s of 60 s).
    render(section({ onChange, value: { bpm: 120, anchorSec: 0.3 } }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    fireEvent.click(screen.getByTestId('grid-beat-here'))
    const grid = onChange.mock.calls[0][0]
    // 30.0 folds to phase 0: the first beat moves to 0.00 and a beat now sits
    // at exactly 30.0, under the line.
    expect(grid.anchorSec).toBe(0)
    expect(grid.bpm).toBe(120)
  })

  // Nudging an anchor walks it away from the line — and the moment it left the
  // magnet's catch window, the controls used to fall back to the segment BEHIND
  // the line, mid-edit ("the right part stops and the left starts moving"). The
  // segment last edited stays the target until the view itself moves.
  it('keeps the controls on the edited segment after its anchor leaves the magnet', async () => {
    const onChange = vi.fn()
    stubOverlayRect()
    // Diamond one whole beat right of the line (30.25 vs centre 30.0), inside
    // the catch window (0.667 s at this view).
    const first = { bpm: 120, anchorSec: 0.25, changes: [{ anchorSec: 30.25, bpm: 120 }] }
    const { rerender } = render(section({ onChange, value: first }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    // A whole-beat step carries the diamond to 30.75 — beyond the catch window.
    fireEvent.click(screen.getByTestId('grid-beat-forward'))
    const once = onChange.mock.calls[0][0]
    expect(once.changes[0].anchorSec).toBeCloseTo(30.75, 3)
    rerender(section({ onChange, value: once }))
    onChange.mockClear()
    // The next step must STILL move the diamond, not the base grid the line
    // now happens to sit over.
    fireEvent.click(screen.getByTestId('grid-beat-forward'))
    const twice = onChange.mock.calls[0][0]
    expect(twice.anchorSec).toBe(0.25)
    expect(twice.changes[0].anchorSec).toBeCloseTo(31.25, 3)
  })

  // Auto is segment-scoped like every other control: over a tempo-change
  // segment it re-detects THAT stretch only (via the windowed IPC) and leaves
  // the base grid alone. The full-track reset stays the base's behavior.
  it('re-detects only the segment under the line on Auto', async () => {
    const onChange = vi.fn()
    const beatgridWindow = vi
      .fn()
      .mockResolvedValue({ bpm: 174, confidence: 0.9, anchorSec: 30.31, phaseAmbiguity: 0, phaseMargin: 9 })
    ;(window as unknown as { api: { beatgridWindow: unknown } }).api.beatgridWindow =
      beatgridWindow
    stubOverlayRect()
    // The line (centre 30.0 of 60 s) sits within the change segment [30.25, end).
    // Wait — 30.0 < 30.25 puts the line on the base; the magnet catches the
    // diamond at 30.25 (0.25 < 0.667 catch) and anchors outrank beats, so the
    // controls target the change segment.
    render(
      section({
        onChange,
        value: { bpm: 120, anchorSec: 0.25, changes: [{ anchorSec: 30.25, bpm: 120 }] },
      }),
    )
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    fireEvent.click(screen.getByTestId('grid-reset'))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    // The window asked for exactly the segment's stretch: anchor to track end.
    expect(beatgridWindow).toHaveBeenCalledWith('/in/track.wav', 30.25, 60 - 30.25)
    const grid = onChange.mock.calls[0][0]
    expect(grid.bpm).toBe(120)
    expect(grid.anchorSec).toBe(0.25)
    expect(grid.changes[0]).toEqual({ anchorSec: 30.31, bpm: 174 })
  })

  // Aligning a grid is dozens of tiny steps: holding a stepper must keep
  // stepping (fire on press, repeat after a beat) instead of acting once.
  it('repeats a held nudge until release', async () => {
    const onChange = vi.fn()
    stubOverlayRect()
    render(section({ onChange, value: { bpm: 120, anchorSec: 0.25 } }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    vi.useFakeTimers()
    try {
      const later = screen.getByTestId('grid-nudge-later')
      fireEvent.pointerDown(later)
      expect(onChange).toHaveBeenCalledTimes(1)
      // Past the initial delay the hold ticks on its own.
      vi.advanceTimersByTime(350 + 70 * 3 + 5)
      expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(3)
      const before = onChange.mock.calls.length
      fireEvent.pointerUp(later)
      vi.advanceTimersByTime(500)
      expect(onChange.mock.calls.length).toBe(before)
    } finally {
      vi.useRealTimers()
    }
  })

  // The nudges are the most-used control by far, and the eye is already at the red
  // line when it reaches for them — so they live under it, not in the strip of 17
  // identical glyphs the top row had become.
  it('puts the nudges under the reference line, not in the top toolbar', async () => {
    const onChange = vi.fn()
    stubOverlayRect()
    render(section({ onChange, value: { bpm: 120, anchorSec: 0.25 } }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    const bar = screen.getByTestId('grid-nudge-bar')
    for (const id of [
      'grid-beat-back',
      'grid-nudge-earlier',
      'grid-nudge-later',
      'grid-beat-forward',
    ]) {
      expect(bar).toContainElement(screen.getByTestId(id))
    }
    // And they still act on the grid from there.
    fireEvent.click(screen.getByTestId('grid-nudge-later'))
    expect(onChange.mock.calls[0][0].anchorSec).toBeCloseTo(0.26, 3)
  })

  // rekordbox's C (and its button): bring the nearest beat under the reference,
  // so the controls act on a beat instead of an arbitrary instant.
  it('centres the nearest beat under the reference from the button', async () => {
    stubOverlayRect()
    render(section({ value: { bpm: 120, anchorSec: 0.25 } }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    const scroller = screen.getByTestId('waveform-scroller')
    // jsdom lays nothing out, so the lane's geometry is stubbed like the other
    // navigation tests: a 6000 px strip in a 600 px panel.
    Object.defineProperty(scroller, 'scrollWidth', { value: 6000, configurable: true })
    Object.defineProperty(scroller, 'clientWidth', { value: 600, configurable: true })
    // The lane scrolls so the beat nearest the centre (30.25 s of the 60 s track)
    // lands under the reference: beat_ratio × scrollWidth − half a panel.
    fireEvent.click(screen.getByTestId('grid-centre-beat'))
    expect(scroller.scrollLeft).toBeCloseTo((30.25 / 60) * 6000 - 300, 0)
  })

  // "Adjust from here" fixes the stretch AHEAD of the centre reference, so the
  // new segment must start on the first beat AT OR AFTER the red line — a beat
  // behind it would re-anchor music the user is deliberately leaving alone.
  it('stages a change on the first beat at or after the centre reference', async () => {
    const onChange = vi.fn()
    stubOverlayRect()
    render(section({ onChange, value: { bpm: 120, anchorSec: 0.25 } }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    // Centre of the initial full-track view: 30 s. At 120 bpm phased to 0.25 s
    // the beats around it are 29.75 s and 30.25 s — the one AFTER wins, even
    // though 29.75 s is equally near.
    fireEvent.click(screen.getByTestId('grid-from-here'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toEqual({
      bpm: 120,
      anchorSec: 0.25,
      changes: [{ anchorSec: 30.25, bpm: 120 }],
    })
  })

  it('nudges only the segment whose handle is focused', async () => {
    const onChange = vi.fn()
    stubOverlayRect()
    render(
      section({
        onChange,
        value: { bpm: 120, anchorSec: 0.25, changes: [{ anchorSec: 30.25, bpm: 120 }] },
      }),
    )
    const handle = await screen.findByTestId('grid-change-handle', undefined, { timeout: 3000 })
    // The arrows move that change alone; what's behind it stays pinned.
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].anchorSec).toBeCloseTo(0.25, 6)
    expect(onChange.mock.calls[0][0].changes[0].anchorSec).toBeCloseTo(30.26, 2)
  })

  // The lane's one pointer gesture: grab the wave and pan it (hand cursors).
  it('pans the wave from a press anywhere on the lane', async () => {
    const onChange = vi.fn()
    stubOverlayRect()
    render(section({ onChange, value: { bpm: 120, anchorSec: 0.25 } }))
    const overlay = await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    expect(overlay.style.cursor).toBe('grab')
    const scroller = overlay.parentElement?.parentElement as HTMLElement
    fireEvent.pointerDown(overlay, { clientX: 1050, pointerId: 1 })
    expect(overlay.style.cursor).toBe('grabbing')
    fireEvent.pointerMove(overlay, { clientX: 850, pointerId: 1 })
    expect(scroller.scrollLeft).toBe(200)
    fireEvent.pointerUp(overlay, { pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
  })

  // rekordbox's centre reference: the fixed line marks the position the
  // segment-scoped controls target, and the chip turns phase drift into a
  // number (bars from the active segment's downbeat).
  it('pins a centre reference line with the bar offset from the anchor', async () => {
    stubOverlayRect()
    render(section({ value: { bpm: 120, anchorSec: 0.25 } }))
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    expect(screen.getByTestId('grid-center-line')).toBeInTheDocument()
    // Initial view spans the whole 60 s track: the centre (30 s) magnetises onto
    // the beat at 30.25 s, which is exactly 15 bars past the 0.25 s anchor at
    // 120 bpm — the magnet is what makes the offset a round number.
    expect(screen.getByTestId('grid-center-bars')).toHaveTextContent('+15.0 bars')
  })

  it('removes a focused change with Delete', async () => {
    const onChange = vi.fn()
    render(
      section({
        onChange,
        value: { bpm: 120, anchorSec: 0.25, changes: [{ anchorSec: 30.25, bpm: 120 }] },
      }),
    )
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    const handle = screen.getByTestId('grid-change-handle')
    fireEvent.keyDown(handle, { key: 'Delete' })
    expect(onChange).toHaveBeenCalledWith({ bpm: 120, anchorSec: 0.25 })
  })
})

describe('GridSection undo/redo', () => {
  function Harness(): React.JSX.Element {
    const [grid, setGrid] = useState<Beatgrid | undefined>(undefined)
    return (
      <QueryClientProvider client={client}>
        <GridSection
          value={grid}
          open
          onToggle={() => {}}
          onChange={setGrid}
          inputPath="/in/track.wav"
        />
      </QueryClientProvider>
    )
  }

  // rekordbox's safety net, verbatim: grid edits are exploratory, so every
  // committed step can be walked back — and forward again.
  it('walks committed grid edits back and forward', async () => {
    render(<Harness />)
    await screen.findByTestId('grid-overlay', undefined, { timeout: 3000 })
    const undo = screen.getByTestId('grid-undo')
    const redo = screen.getByTestId('grid-redo')
    expect(undo).toBeDisabled()
    expect(redo).toBeDisabled()
    fireEvent.click(screen.getByTestId('grid-nudge-later'))
    await waitFor(() => expect(screen.getByTestId('grid-anchor')).toHaveTextContent('0.26 s'))
    fireEvent.click(undo)
    // Back to the bare detection (no staged grid).
    await waitFor(() => expect(screen.getByTestId('grid-anchor')).toHaveTextContent('0.25 s'))
    expect(redo).not.toBeDisabled()
    fireEvent.click(redo)
    await waitFor(() => expect(screen.getByTestId('grid-anchor')).toHaveTextContent('0.26 s'))
  })
})

