import { describe, expect, it } from 'vitest'
import type { NormalizeConfig } from '../../../shared/types'
import { clippedCount, drawWaveform, previewPeaks, skeletonPeaks } from './waveform'

const cfg = (over: Partial<NormalizeConfig>): NormalizeConfig => ({
  mode: 'none',
  targetLufs: -14,
  truePeakDb: -1,
  peakDb: -1,
  ...over,
})

// The pre-conversion preview: what the envelope would look like after normalizing,
// computed from the decoded peaks and the measured loudness — a linear gain to the
// target, drawn against the mode's own ceiling (the limiter line).
describe('previewPeaks', () => {
  it('returns null when normalization is off', () => {
    expect(previewPeaks([0.5], cfg({}), -20)).toBeNull()
  })

  it('scales the envelope by the gain to the loudness target', () => {
    // -20 LUFS to -14 LUFS = +6 dB ≈ ×1.995
    const out = previewPeaks([0.1, 0.2], cfg({ mode: 'loudness' }), -20)
    expect(out?.limitDb).toBe(-1)
    expect(out?.gainDb).toBeCloseTo(6, 5)
    expect(out?.peaks[0]).toBeCloseTo(0.1995, 3)
    expect(out?.peaks[1]).toBeCloseTo(0.399, 3)
  })

  it('needs the loudness measurement for the loudness mode', () => {
    expect(previewPeaks([0.5], cfg({ mode: 'loudness' }), null)).toBeNull()
    expect(previewPeaks([0.5], cfg({ mode: 'loudness' }), Number.NEGATIVE_INFINITY)).toBeNull()
  })

  it('scales the loudest peak exactly to the peak target', () => {
    const out = previewPeaks([0.5, 0.25], cfg({ mode: 'peak', peakDb: 0 }), null)
    expect(out?.gainDb).toBeCloseTo(6.0206, 3)
    expect(out?.peaks[0]).toBeCloseTo(1, 5)
    expect(out?.peaks[1]).toBeCloseTo(0.5, 5)
  })

  // Peak mode's red line is digital clipping, not the target: scaling the loudest
  // sample TO the target means nothing ever exceeds the target by construction, so
  // marking against it could never show red. Against 0 dBFS the marks become the
  // feedback that finds the optimal value — dial the target up, red appears where
  // the output would clip, back off until it is gone.
  it('marks the peak preview against digital clipping, not the target', () => {
    expect(previewPeaks([0.5], cfg({ mode: 'peak', peakDb: -1 }), null)?.limitDb).toBe(0)
    expect(previewPeaks([0.5], cfg({ mode: 'peak', peakDb: 1.8 }), null)?.limitDb).toBe(0)
  })

  it('returns null for a silent decode in peak mode', () => {
    expect(previewPeaks([0, 0], cfg({ mode: 'peak' }), null)).toBeNull()
  })
})

describe('clippedCount', () => {
  // The red clip marks answer "where does this track poke over the ceiling", so the
  // count must translate the dB ceiling to linear amplitude and compare strictly:
  // a normalized output sitting exactly AT its ceiling is compliant, not clipping.
  it('counts only the peaks strictly above the dB ceiling', () => {
    // -1 dB ≈ 0.891 linear: 1.0 and 0.95 poke over, 0.891 sits at it, 0.5 is clear.
    expect(clippedCount([1, 0.95, 0.891, 0.5], -1)).toBe(2)
  })

  it('returns zero for a track that never reaches the ceiling', () => {
    expect(clippedCount([0.2, 0.6, 0.85], -1)).toBe(0)
  })

  // A track mastered right up to the ceiling is the normal case, not a fault: that is
  // what a limiter set to -1 dBTP produces. The envelope it is measured against comes
  // from a 4 kHz mono decode, whose resampling ripples the reconstructed peaks by up
  // to ~0.24 dB — so a compliant master lands a handful of buckets a hair over the
  // line and the legend cried "Peaks over -1.0 dB" at a file that peaks at -1.0 dB.
  // Only an excess past that decode slop is a real over.
  it('ignores buckets riding the ceiling within the decode tolerance', () => {
    // -1 dB = 0.891; +0.2 dB over it = 0.912 — inside the ripple, not clipping.
    expect(clippedCount([0.912, 0.9, 0.891], -1)).toBe(0)
  })

  it('still counts peaks that clear the ceiling by more than the decode slop', () => {
    // +0.5 dB over -1 dB = 0.944, past any resampling artefact: a genuine over.
    expect(clippedCount([0.944, 1.0], -1)).toBe(2)
  })
})

describe('skeletonPeaks', () => {
  it('builds a varied envelope so the decode placeholder reads as a waveform, not equal bars', () => {
    // The old placeholder was a repeating gradient of identical bars, which looked
    // nothing like a real track. A synthetic envelope of differing heights is the
    // fix, so the generator must produce a spread of amplitudes, not a flat row.
    const peaks = skeletonPeaks(64)
    expect(peaks).toHaveLength(64)
    for (const p of peaks) {
      // Each bar stays on the strip: a visible floor, never taller than full height.
      expect(p).toBeGreaterThan(0)
      expect(p).toBeLessThanOrEqual(1)
    }
    expect(new Set(peaks).size).toBeGreaterThan(10)
  })

  it('is deterministic so the pulsing placeholder never reflows its shape mid-decode', () => {
    expect(skeletonPeaks(64)).toEqual(skeletonPeaks(64))
  })
})

// The overview always has far more buckets than raster pixels (8192 over ~1200), so the
// strip reduces to one column per pixel before drawing instead of painting ~7 sub-pixel
// bars into each one. That reduction is the part that can silently lie: whatever it
// merges away is gone from the picture the DJ reads. These pin what must survive it.
describe('drawWaveform column reduction', () => {
  // jsdom has no 2D context, so record the geometry the draw asks for. Each fill is
  // tagged with the colour in force, which is how a peak bar is told from an RMS core
  // and from a clip mark.
  function recordingCanvas(width: number, height = 96) {
    const fills: { x: number; y: number; w: number; h: number; color: string }[] = []
    const ctx = {
      fillStyle: '',
      clearRect: () => {},
      fillRect(x: number, y: number, w: number, h: number) {
        fills.push({ x, y, w, h, color: String(ctx.fillStyle) })
      },
    }
    const canvas = { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement
    return { canvas, fills, ctx }
  }

  const BLUE = 'rgba(96, 165, 250, 0.8)'
  const RED = 'rgba(247, 118, 142, 0.95)'
  // A quiet envelope with one lone full-scale hit, the shape the max-abs reduction
  // exists for: a kick is a handful of hot buckets inside an otherwise soft passage.
  function withSpikeAt(index: number, count = 8192): { peaks: number[]; rms: number[] } {
    const peaks = new Array<number>(count).fill(0.1)
    peaks[index] = 1
    return { peaks, rms: peaks.map((p) => p * 0.5) }
  }

  it('keeps a lone transient at full height when many buckets share one pixel', () => {
    // Averaging the merged buckets would bury the hit under its quiet neighbours —
    // erasing the very thing the DJ lines the playhead up against.
    const { canvas, fills } = recordingCanvas(1200)
    const { peaks, rms } = withSpikeAt(4001)
    drawWaveform(canvas, peaks, { color: BLUE, rms })
    const tallest = fills.reduce((m, f) => (f.h > m.h ? f : m), fills[0])
    // Full scale spans the lane: 2 × (48 − 2).
    expect(tallest.h).toBeCloseTo(92, 5)
  })

  it('draws one column per raster pixel rather than one bar per bucket', () => {
    // The reason for the reduction: 8192 buckets over 1200 pixels painted each pixel
    // ~7 times, at two canvas state changes per bar.
    const { canvas, fills } = recordingCanvas(1200)
    const { peaks, rms } = withSpikeAt(4001)
    drawWaveform(canvas, peaks, { color: BLUE, rms })
    expect(fills.length).toBeLessThanOrEqual(2400)
    expect(fills.every((f) => f.w === 1)).toBe(true)
  })

  it('still marks a clip that shares its pixel with clean buckets', () => {
    // Clip marks are per-bucket truth, and a single clipped bucket lands in a pixel
    // with ~7 clean ones. Merging by "most buckets are fine" would drop the red mark
    // that says a limiter acted — the strip would show a clean wave over a clipped file.
    const { canvas, fills } = recordingCanvas(1200)
    const peaks = new Array<number>(8192).fill(0.1)
    const clipped = new Array<boolean>(8192).fill(false)
    clipped[4001] = true
    drawWaveform(canvas, peaks, { color: BLUE, clipped })
    expect(fills.some((f) => f.color === RED)).toBe(true)
  })

  it('keeps the RMS body inside the peak outline it sits in', () => {
    // The two-layer draw only reads if the solid core stays under the translucent
    // envelope; a core merged by a rule that can exceed its own peak would paint
    // outside the bar containing it.
    const { canvas, fills } = recordingCanvas(1200)
    const peaks = Array.from({ length: 8192 }, (_, i) => 0.2 + 0.7 * Math.abs(Math.sin(i / 40)))
    const rms = peaks.map((p) => p * 0.8)
    drawWaveform(canvas, peaks, { color: BLUE, rms })
    const cores = fills.filter((f) => f.color !== BLUE && f.color !== RED)
    expect(cores.length).toBeGreaterThan(0)
    for (const core of cores) {
      const outline = fills.find((f) => f.color === BLUE && f.x === core.x)
      if (outline) expect(core.h).toBeLessThanOrEqual(outline.h + 1e-9)
    }
  })

  it('leaves the zoomed-in draw alone, where each bucket is wider than a pixel', () => {
    // Past the crossover the strip has FEWER buckets than pixels and interpolates
    // between bucket centres instead. The reduction must not capture that path, or a
    // deep zoom would redraw the blocky wave the interpolation exists to replace.
    const { canvas, fills } = recordingCanvas(1200)
    const peaks = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 0.9 : 0.2))
    drawWaveform(canvas, peaks, { color: BLUE })
    expect(fills.length).toBeGreaterThan(1000)
  })
})
