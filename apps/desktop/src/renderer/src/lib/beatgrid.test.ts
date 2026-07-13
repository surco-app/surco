import { describe, expect, it } from 'vitest'
import type { BeatgridResult } from '../../../shared/types'
import type { TrackItem } from '../types'
import { beatgridNeedsReview, exportAnchorSec, gridLines } from './beatgrid'

const FULL = { from: 0, to: 1 }

describe('gridLines', () => {
  it('lays a beat every period from the anchor, downbeats every fourth', () => {
    // Half the track in view keeps the beat count under the thinning cap, so
    // every beat renders and the phase/downbeat pattern is assertable 1:1.
    const lines = gridLines({ bpm: 120, anchorSec: 0.25 }, 60, { from: 0, to: 0.5 })
    expect(lines[0]).toMatchObject({ sec: 0.25, downbeat: true })
    expect(lines[1].sec).toBeCloseTo(0.75, 10)
    expect(lines[1].downbeat).toBe(false)
    expect(lines[4].sec).toBeCloseTo(2.25, 10)
    expect(lines[4].downbeat).toBe(true)
    expect(lines[0].pct).toBeCloseTo((0.25 / 60) * 100, 10)
  })

  // The anchor is whatever beat the user grabbed — dragging it mid-song must
  // keep the grid covering the whole track, so beats extend backwards too.
  it('extends the grid before a mid-track anchor', () => {
    const lines = gridLines({ bpm: 120, anchorSec: 30 }, 60, { from: 0, to: 0.1 })
    expect(lines[0].sec).toBeCloseTo(0, 10)
    expect(lines.some((l) => l.sec < 0)).toBe(false)
    // 4 s is a whole number of bars (13 × 4 beats × 0.5 s) before the anchor at
    // 30 s; 4.5 s is not — the downbeat count stays phased to the anchor.
    const at = (sec: number) => lines.find((l) => Math.abs(l.sec - sec) < 1e-6)
    expect(at(4)?.downbeat).toBe(true)
    expect(at(4.5)?.downbeat).toBe(false)
  })

  // A 10-minute techno track holds well over a thousand beats: rendered
  // full-length they would swamp the DOM, so the density thins by whole bars
  // until the count is bounded — what remains still marks the phase.
  it('thins a long track to sparse whole-bar ticks', () => {
    const lines = gridLines({ bpm: 128, anchorSec: 0 }, 600, FULL)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.length).toBeLessThanOrEqual(96)
    // Whole bars only: a mix of on- and off-bar beats at overview zoom is noise.
    expect(lines.every((l) => l.downbeat)).toBe(true)
  })

  it('renders every beat when the view is zoomed into a short window', () => {
    const lines = gridLines({ bpm: 128, anchorSec: 0 }, 600, { from: 0.5, to: 0.51 })
    const period = 60 / 128
    const secs = lines.map((l) => l.sec)
    // Every consecutive pair is exactly one beat apart — no thinning this deep.
    for (let i = 1; i < secs.length; i++) expect(secs[i] - secs[i - 1]).toBeCloseTo(period, 6)
    // Only what shows (plus one beat of margin either side) is rendered.
    expect(secs[0]).toBeGreaterThanOrEqual(300 - period - 1e-6)
    expect(secs[secs.length - 1]).toBeLessThanOrEqual(306 + period + 1e-6)
  })

  it('returns nothing without a duration', () => {
    expect(gridLines({ bpm: 128, anchorSec: 0 }, 0, FULL)).toEqual([])
  })

  // With a NaN anchor the loop's `sec > toSec` exit is false forever and the
  // line array grows until the renderer dies of OOM — a NaN must draw nothing.
  it('refuses non-finite grids instead of allocating forever', () => {
    expect(gridLines({ bpm: 128, anchorSec: Number.NaN }, 60, FULL)).toEqual([])
    expect(gridLines({ bpm: Number.NaN, anchorSec: 0 }, 60, FULL)).toEqual([])
    expect(gridLines({ bpm: 0, anchorSec: 0 }, 60, FULL)).toEqual([])
  })
})

describe('beatgridNeedsReview', () => {
  const grid = (over: Partial<BeatgridResult>): BeatgridResult => ({
    bpm: 128,
    confidence: 0.8,
    anchorSec: 0.25,
    phaseAmbiguity: 0.1,
    phaseMargin: 5,
    ...over,
  })

  it('trusts a confident, unambiguous grid', () => {
    expect(beatgridNeedsReview(grid({}))).toBe(false)
  })

  // The real calibration case: heavy sidechain makes the attacks tie, but the
  // kick side's low-band energy wins decisively — the grid is right, so
  // flagging it would drown the filter in every pumping trance track.
  it('trusts an ambiguous grid whose energy vote was decisive', () => {
    expect(beatgridNeedsReview(grid({ phaseAmbiguity: 1, phaseMargin: 1.9 }))).toBe(false)
  })

  // Two equal hit trains half a period apart: nothing broke the tie, the beat
  // choice is a coin flip — exactly what an ear must settle.
  it('flags a coin flip the energy could not break', () => {
    expect(beatgridNeedsReview(grid({ phaseAmbiguity: 1, phaseMargin: 1.0 }))).toBe(true)
  })

  // An ambiguity under 0.9 means the full-band attack evidence itself chose a
  // side — a decision, not a coin flip. Ordinary off-beat-bass dance music
  // lives at 0.6–0.9 ambiguity, and flagging that band buried the filter in
  // false positives.
  it('trusts a grid whose attack evidence favored one side', () => {
    expect(beatgridNeedsReview(grid({ phaseAmbiguity: 0.8, phaseMargin: 0.94 }))).toBe(false)
  })

  // The real 147 BPM hard-dance rip after the sub-attack voter fixed its phase:
  // full-band flux stays fooled by the off-beat stab (ambiguity 1.0), but the
  // low-band attack settled the side at 1.5 — the detector's own decisive bar,
  // so the triage must not second-guess it.
  it('trusts a grid a low-band voter settled decisively', () => {
    expect(beatgridNeedsReview(grid({ phaseAmbiguity: 1, phaseMargin: 1.5 }))).toBe(false)
  })

  it('flags a shaky tempo outright', () => {
    expect(beatgridNeedsReview(grid({ confidence: 0.27 }))).toBe(true)
  })

  it('never flags a track with no detection', () => {
    expect(beatgridNeedsReview(null)).toBe(false)
    expect(beatgridNeedsReview(undefined)).toBe(false)
  })
})

function track(over: Partial<TrackItem>): Pick<TrackItem, 'beatgrid' | 'trim' | 'outputPath'> {
  return { beatgrid: undefined, trim: undefined, outputPath: undefined, ...over }
}

describe('exportAnchorSec', () => {
  it('is undefined without a grid', () => {
    expect(exportAnchorSec(track({}))).toBeUndefined()
  })

  it('passes the anchor through untouched for an unconverted track', () => {
    // The export points at the original file, which still carries its head:
    // subtracting a merely staged trim would misplace the grid.
    const t = track({ beatgrid: { bpm: 120, anchorSec: 2 }, trim: { startSec: 1.5 } })
    expect(exportAnchorSec(t)).toBe(2)
  })

  it('offsets the anchor by the trimmed head on a converted track', () => {
    const t = track({
      beatgrid: { bpm: 120, anchorSec: 2 },
      trim: { startSec: 1.5 },
      outputPath: '/out/a.aiff',
    })
    expect(exportAnchorSec(t)).toBeCloseTo(0.5, 10)
  })

  // A trim that swallows the anchor beat must land on the SAME grid's first
  // surviving beat, never on a negative time no DJ software accepts.
  it('folds forward by whole beats when the trim passes the anchor', () => {
    const t = track({
      beatgrid: { bpm: 120, anchorSec: 0.3 },
      trim: { startSec: 1.5 },
      outputPath: '/out/a.aiff',
    })
    expect(exportAnchorSec(t)).toBeCloseTo(0.3, 10)
  })

  it('keeps the anchor as-is on a converted track with no trim', () => {
    const t = track({ beatgrid: { bpm: 120, anchorSec: 2 }, outputPath: '/out/a.aiff' })
    expect(exportAnchorSec(t)).toBe(2)
  })
})
