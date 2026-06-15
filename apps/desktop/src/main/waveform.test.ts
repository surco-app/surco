import { describe, expect, it } from 'vitest'
import { computePeaks, WAVEFORM_BUCKETS } from './waveform'

describe('computePeaks', () => {
  it('reduces long PCM to exactly the requested bucket count', () => {
    // The renderer draws one bar per bucket, so the contract is a fixed-size
    // array regardless of track length — a 2-minute edit and a 10-minute mix
    // both render at the same resolution.
    const samples = new Float32Array(100_000).fill(0.5)
    expect(computePeaks(samples, 64)).toHaveLength(64)
    expect(computePeaks(samples)).toHaveLength(WAVEFORM_BUCKETS)
  })

  it('keeps a single transient visible as the max of its bucket', () => {
    // Peaks must be max, not mean: a kick is a few samples of energy inside a
    // mostly quiet bucket, and averaging would erase exactly the hits the DJ
    // is trying to line the playhead against.
    const samples = new Float32Array(1000)
    samples[500] = 1
    const peaks = computePeaks(samples, 10)
    expect(peaks[5]).toBe(1)
    expect(peaks[0]).toBe(0)
  })

  it('measures negative excursions too', () => {
    // PCM is signed and a hit can swing negative-first; the drawn waveform is
    // symmetric, so a negative-only peak must register at full height.
    const samples = new Float32Array(100)
    samples[10] = -0.8
    expect(Math.max(...computePeaks(samples, 10))).toBeCloseTo(0.8, 5)
  })

  it('clamps float PCM that overshoots full scale', () => {
    // Hot lossy decodes can exceed ±1.0; the renderer scales bars by bucket
    // value × height, so anything above 1 would draw outside the canvas.
    const samples = new Float32Array(100).fill(1.4)
    expect(Math.max(...computePeaks(samples, 4))).toBe(1)
  })

  it('returns one bucket per sample when the input is shorter than the bucket count', () => {
    // A clip shorter than the bucket count must not fabricate interpolated
    // buckets — the array length is the honest amount of data available.
    expect(computePeaks(new Float32Array(8).fill(0.3), 2048)).toHaveLength(8)
    expect(computePeaks(new Float32Array(0))).toHaveLength(0)
  })
})
