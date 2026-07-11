import { describe, expect, it } from 'vitest'
import type { NormalizeConfig } from '../../../shared/types'
import { clippedCount, previewPeaks, skeletonPeaks } from './waveform'

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
    expect(out?.peaks[0]).toBeCloseTo(0.1995, 3)
    expect(out?.peaks[1]).toBeCloseTo(0.399, 3)
  })

  it('needs the loudness measurement for the loudness mode', () => {
    expect(previewPeaks([0.5], cfg({ mode: 'loudness' }), null)).toBeNull()
    expect(previewPeaks([0.5], cfg({ mode: 'loudness' }), Number.NEGATIVE_INFINITY)).toBeNull()
  })

  it('scales the loudest peak exactly to the peak target', () => {
    const out = previewPeaks([0.5, 0.25], cfg({ mode: 'peak', peakDb: 0 }), null)
    expect(out?.limitDb).toBe(0)
    expect(out?.peaks[0]).toBeCloseTo(1, 5)
    expect(out?.peaks[1]).toBeCloseTo(0.5, 5)
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

  it('flags full-scale peaks against the no-normalization clip line', () => {
    // -0.1 dB ≈ 0.9886: only true digital clipping marks when no ceiling is set.
    expect(clippedCount([1, 0.985, 0.7], -0.1)).toBe(1)
  })

  it('returns zero for a track that never reaches the ceiling', () => {
    expect(clippedCount([0.2, 0.6, 0.85], -1)).toBe(0)
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
