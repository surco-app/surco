import { describe, expect, it } from 'vitest'
import { CLIP_SAMPLE, computePeaks, createChannelScan, WAVEFORM_BUCKETS } from './waveform'

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

describe('createChannelScan', () => {
  it('flags the bucket holding a full-scale sample and leaves the rest clear', () => {
    const scan = createChannelScan(1, 16)
    const chunk = new Float32Array(10240).fill(0.5)
    chunk[5000] = 1
    scan.push(chunk)
    const { clipped } = scan.finish()
    expect(clipped).toHaveLength(16)
    expect(clipped[Math.floor((5000 * 16) / 10240)]).toBe(true)
    expect(clipped.filter(Boolean)).toHaveLength(1)
  })

  it('marks both int16 rails but not merely hot samples', () => {
    // Audacity's MAX_AUDIO line (32767/32768): the rails a clipped encode pins at.
    // A master riding at 0.998 for a whole section is loud, not clipped — that
    // distinction is the entire point of scanning raw samples.
    const at = (v: number): boolean => {
      const scan = createChannelScan(1, 4)
      const chunk = new Float32Array(4096).fill(0.1)
      chunk[100] = v
      scan.push(chunk)
      return scan.finish().clipped[0]
    }
    expect(at(32767 / 32768)).toBe(true)
    expect(at(-1)).toBe(true)
    expect(at(1.2)).toBe(true)
    expect(at(0.998)).toBe(false)
    expect(at(-0.998)).toBe(false)
  })

  it('sees a clip that lives in only one stereo channel, and says which', () => {
    // The 4 kHz waveform decode downmixes to mono, and (L+R)/2 averages a pinned
    // channel away — exactly how the old marks missed real clipping. The scan reads
    // interleaved samples per channel, so a one-channel rail still flags, and the
    // per-channel flags let the split view mark only the lane that clipped.
    const scan = createChannelScan(2, 8)
    const chunk = new Float32Array(16384).fill(0.2)
    chunk[9001] = -1
    scan.push(chunk)
    const { clipped, channels } = scan.finish()
    const bucket = Math.floor((Math.floor(9001 / 2) * 8) / 8192)
    expect(clipped[bucket]).toBe(true)
    expect(channels[1].clipped[bucket]).toBe(true)
    expect(channels[0].clipped.some(Boolean)).toBe(false)
  })

  it('keeps frame accounting across chunks split mid-frame', () => {
    // ffmpeg's stdout chunks at arbitrary byte offsets, so a stereo frame can be
    // torn across two pushes; the running sample index must keep channel phase.
    const scan = createChannelScan(2, 8)
    const first = new Float32Array(4097).fill(0.2)
    const second = new Float32Array(4095).fill(0.2)
    second[0] = 1
    scan.push(first)
    scan.push(second)
    const frame = Math.floor(4097 / 2)
    expect(scan.finish().clipped[Math.floor((frame * 8) / 4096)]).toBe(true)
  })

  it('builds each channel its own envelope for the split view', () => {
    // Audacity-style L/R lanes need per-channel peaks; the mono strip's envelope
    // averages the channels, so a one-sided track would draw two identical lanes.
    const scan = createChannelScan(2, 4)
    const chunk = new Float32Array(8192)
    for (let i = 0; i < chunk.length; i += 2) {
      chunk[i] = 0.8
      chunk[i + 1] = -0.2
    }
    scan.push(chunk)
    const { channels } = scan.finish()
    expect(channels).toHaveLength(2)
    expect(channels[0].peaks.every((p) => Math.abs(p - 0.8) < 1e-6)).toBe(true)
    expect(channels[1].peaks.every((p) => Math.abs(p - 0.2) < 1e-6)).toBe(true)
  })

  it('clamps channel peaks that overshoot full scale', () => {
    // Same guard as computePeaks: the renderer scales bars by peak × height, so a
    // hot lossy decode past ±1.0 must not draw outside its lane.
    const scan = createChannelScan(1, 2)
    scan.push(new Float32Array(2048).fill(1.4))
    const { channels } = scan.finish()
    expect(Math.max(...channels[0].peaks)).toBe(1)
  })

  it('defaults to the waveform bucket count and stays clear on silence', () => {
    const scan = createChannelScan(2)
    scan.push(new Float32Array(8192))
    const { clipped, channels } = scan.finish()
    expect(clipped).toHaveLength(WAVEFORM_BUCKETS)
    expect(clipped.some(Boolean)).toBe(false)
    expect(channels[0].peaks).toHaveLength(WAVEFORM_BUCKETS)
  })

  it('returns all-clear for an empty decode', () => {
    const { clipped, channels } = createChannelScan(2, 8).finish()
    expect(clipped).toEqual(new Array(8).fill(false))
    expect(channels[0].peaks).toEqual(new Array(8).fill(0))
    expect(channels[1].clipped).toEqual(new Array(8).fill(false))
  })

  it('exports the Audacity full-scale line for the scan threshold', () => {
    expect(CLIP_SAMPLE).toBeCloseTo(32767 / 32768, 10)
  })
})
