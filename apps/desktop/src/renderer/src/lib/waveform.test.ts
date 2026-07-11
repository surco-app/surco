import { describe, expect, it } from 'vitest'
import { clippedCount, skeletonPeaks } from './waveform'

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
