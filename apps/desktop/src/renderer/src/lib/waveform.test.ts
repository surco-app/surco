import { describe, expect, it } from 'vitest'
import { skeletonPeaks } from './waveform'

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
