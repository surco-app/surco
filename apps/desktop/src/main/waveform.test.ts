import { describe, expect, it } from 'vitest'
import { CLIP_SAMPLE, computePeaks, createChannelScan, WAVEFORM_BUCKETS } from './waveform'

describe('computePeaks', () => {
  it('reduces long PCM to exactly the requested bucket count', () => {
    // The renderer draws one bar per bucket, so the contract is a fixed-size
    // array regardless of track length — a 2-minute edit and a 10-minute mix
    // both render at the same resolution.
    const samples = new Float32Array(100_000).fill(0.5)
    expect(computePeaks(samples, 64).peaks).toHaveLength(64)
    expect(computePeaks(samples).peaks).toHaveLength(WAVEFORM_BUCKETS)
  })

  it('keeps a single transient visible as the max of its bucket', () => {
    // Peaks must be max, not mean: a kick is a few samples of energy inside a
    // mostly quiet bucket, and averaging would erase exactly the hits the DJ
    // is trying to line the playhead against.
    const samples = new Float32Array(1000)
    samples[500] = 1
    const { peaks } = computePeaks(samples, 10)
    expect(peaks[5]).toBe(1)
    expect(peaks[0]).toBe(0)
  })

  it('measures negative excursions too', () => {
    // PCM is signed and a hit can swing negative-first; the drawn waveform is
    // symmetric, so a negative-only peak must register at full height.
    const samples = new Float32Array(100)
    samples[10] = -0.8
    expect(Math.max(...computePeaks(samples, 10).peaks)).toBeCloseTo(0.8, 5)
  })

  it('clamps float PCM that overshoots full scale', () => {
    // Hot lossy decodes can exceed ±1.0; the renderer scales bars by bucket
    // value × height, so anything above 1 would draw outside the canvas.
    const samples = new Float32Array(100).fill(1.4)
    expect(Math.max(...computePeaks(samples, 4).peaks)).toBe(1)
  })

  it('returns one bucket per sample when the input is shorter than the bucket count', () => {
    // A clip shorter than the bucket count must not fabricate interpolated
    // buckets — the array length is the honest amount of data available.
    expect(computePeaks(new Float32Array(8).fill(0.3), 2048).peaks).toHaveLength(8)
    expect(computePeaks(new Float32Array(0)).peaks).toHaveLength(0)
  })

  it('carries an RMS body under each peak so the drawn wave reads dense-vs-transient', () => {
    // Audacity draws two layers — peak envelope plus an RMS core — and that
    // second layer is what makes transients pop out of sustained material. A
    // steady 0.5 signal has RMS = peak; a lone transient has RMS far below its
    // peak, which is exactly the contrast the strip needs to show.
    const steady = computePeaks(new Float32Array(1000).fill(0.5), 10)
    expect(steady.rms).toHaveLength(10)
    expect(steady.rms[0]).toBeCloseTo(0.5, 5)

    const transient = new Float32Array(1000)
    transient[500] = 1
    const spiky = computePeaks(transient, 10)
    expect(spiky.peaks[5]).toBe(1)
    expect(spiky.rms[5]).toBeCloseTo(Math.sqrt(1 / 100), 5)
  })

  it('clamps RMS to the clamped peak so the body never draws past the envelope', () => {
    // Hot lossy decodes overshoot ±1.0; the peak clamps to 1, and an RMS above
    // it would paint the solid core wider than the envelope containing it.
    const { peaks, rms } = computePeaks(new Float32Array(100).fill(1.4), 4)
    expect(Math.max(...rms)).toBeLessThanOrEqual(Math.max(...peaks))
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

// The mono envelope the strip draws used to come from a SECOND ffmpeg pass that decoded
// the same file again at 4 kHz. These lock the contract that lets one native decode feed
// both probes: the scan now also reduces the mono mix, so peaks/rms must match what the
// separate computePeaks pass produced — same grid, same levels, same averaging.
describe('createChannelScan mono envelope', () => {
  it('averages the channels rather than summing them, so a master keeps its own level', () => {
    // The reason the old decode passed `-rematrix_maxval 1.0`: ffmpeg's power-preserving
    // downmix multiplies two correlated channels by √2 (+3.01 dB), and every dB threshold
    // downstream reads this envelope as the file's own level — a track mastered to the
    // -1 dBTP ceiling would light up red end to end. Averaging is what that flag buys,
    // so the in-process reduction has to average too.
    const scan = createChannelScan(2, 4)
    const chunk = new Float32Array(8192)
    for (let i = 0; i < chunk.length; i += 2) {
      chunk[i] = 0.8
      chunk[i + 1] = 0.8
    }
    scan.push(chunk)
    const { mono } = scan.finish()
    expect(Math.max(...mono.peaks)).toBeCloseTo(0.8, 6)
  })

  it('keeps a transient at full height in the mono envelope', () => {
    // Same reason computePeaks reduces by max-abs: a kick is a few hot samples inside an
    // otherwise quiet bucket, and the DJ lines the playhead up against exactly those.
    // Sized so each bucket spans whole CLIP_SCAN_BLOCKs (10 buckets × 512 frames): with
    // fewer frames a bucket covers a fraction of a block and the hit legitimately bleeds
    // into its neighbours, which would test the block grid rather than the max-abs rule.
    const frames = 512 * 10
    const scan = createChannelScan(2, 10)
    const chunk = new Float32Array(frames * 2)
    chunk[512 * 5 * 2] = 1
    chunk[512 * 5 * 2 + 1] = 1
    scan.push(chunk)
    const { mono } = scan.finish()
    expect(mono.peaks[5]).toBeCloseTo(1, 6)
    expect(mono.peaks[0]).toBe(0)
  })

  it('carries an RMS body under every peak, never above it', () => {
    // The two-layer draw (peak outline + solid RMS core) is what lets the eye tell a
    // transient from sustained material; a core drawn past its envelope would paint
    // outside the bar. computePeaks clamps rms to the clamped peak — so must this.
    const scan = createChannelScan(1, 8)
    const chunk = new Float32Array(4096).fill(0.5)
    chunk[0] = 1
    scan.push(chunk)
    const { mono } = scan.finish()
    expect(mono.rms).toHaveLength(8)
    for (let i = 0; i < 8; i++) expect(mono.rms[i]).toBeLessThanOrEqual(mono.peaks[i])
    expect(mono.rms[1]).toBeCloseTo(0.5, 6)
  })

  it('clamps a hot decode so the bar never draws outside the canvas', () => {
    // Float decodes of hot masters overshoot ±1.0 and the renderer scales bars by
    // peak × half-height, exactly the clamp computePeaks applies.
    const scan = createChannelScan(2, 4)
    scan.push(new Float32Array(2048).fill(1.4))
    const { mono } = scan.finish()
    expect(Math.max(...mono.peaks)).toBe(1)
    expect(Math.max(...mono.rms)).toBeLessThanOrEqual(1)
  })

  it('reports the frame count so durationSec stays exact', () => {
    // TrimSection maps cut handles to seconds through durationSec, which the old path
    // derived from the decoded sample count. The native decode has to report frames
    // (not samples) so that mapping survives the switch — a container duration that
    // lies must not creep back in.
    const scan = createChannelScan(2, 4)
    scan.push(new Float32Array(882))
    expect(scan.finish().frames).toBe(441)
  })

  it('stays silent and full-length on an empty decode', () => {
    const { mono, frames } = createChannelScan(2, 8).finish()
    expect(frames).toBe(0)
    expect(mono.peaks).toEqual(new Array(8).fill(0))
    expect(mono.rms).toEqual(new Array(8).fill(0))
  })
})

// The reduction runs a per-block fast path for mono and stereo — accumulators held in
// locals across a whole block instead of indexed per sample, which is what makes one
// native pass beat the 4 kHz decode it replaced. That speed comes from carrying state
// (channel cursor, open block, partial frame) across pushes, and ffmpeg's stdout splits
// at arbitrary byte offsets. So the property that matters is: however the samples are
// sliced, the answer is the answer. A first cut of the mono path failed exactly here —
// it leaked one block's max into the next — and every chunking below caught it.
describe('createChannelScan chunk independence', () => {
  // Long enough to span hundreds of CLIP_SCAN_BLOCKs, and swelling in amplitude so each
  // block's max differs from its neighbours'. Both matter: a short fixture fits in a
  // handful of blocks where a max leaking from one block into the next lands on a
  // similar value and hides, which is exactly how a first cut of this suite passed
  // against a mono path that did leak.
  const signal = (frames: number, channels: number): Float32Array => {
    const pcm = new Float32Array(frames * channels)
    for (let i = 0; i < pcm.length; i++) {
      const swell = 0.05 + 0.9 * (i / pcm.length)
      pcm[i] = Math.sin(i * 0.013) * swell
    }
    // A full-scale sample in each channel, off the block grid, so a leak between blocks
    // moves a clip mark somewhere visible rather than hiding in the noise.
    pcm[50_000 * channels] = 1
    pcm[150_000 * channels + (channels - 1)] = -1
    return pcm
  }
  const digest = (scan: ReturnType<typeof createChannelScan>): string => {
    const r = scan.finish()
    return JSON.stringify([
      r.frames,
      r.clipped,
      r.channels.map((c) => [c.peaks, c.clipped]),
      r.mono.peaks,
      r.mono.rms,
    ])
  }

  for (const channels of [1, 2]) {
    it(`reduces ${channels === 1 ? 'mono' : 'stereo'} identically however the stream is sliced`, () => {
      const pcm = signal(200_000, channels)
      const whole = createChannelScan(channels, 64)
      whole.push(pcm)
      const expected = digest(whole)
      // Sizes chosen to land on and around every boundary the fast path tracks: odd sizes
      // tear a stereo frame in half, 511/512/513 straddle the block edge, and 1 is the
      // pathological case where every push carries state.
      for (const size of [1, 2, 3, 7, 511, 512, 513, 1024, 4096]) {
        const scan = createChannelScan(channels, 64)
        for (let o = 0; o < pcm.length; o += size) {
          scan.push(pcm.subarray(o, Math.min(o + size, pcm.length)))
        }
        expect(digest(scan), `chunk size ${size} disagreed with a single push`).toBe(expected)
      }
    })
  }

  it('agrees with the per-channel lanes it shares the pass with', () => {
    // The mono mix and the lanes come out of one loop over one decode, so they must land
    // on the same grid: a mono envelope that disagreed with the lanes under it would draw
    // clip marks against bars they do not belong to. For a stereo pair the mix is the
    // average, so it can never exceed the louder lane at any bucket.
    const scan = createChannelScan(2, 64)
    scan.push(signal(200_000, 2))
    const { mono, channels } = scan.finish()
    expect(mono.peaks).toHaveLength(64)
    for (let i = 0; i < 64; i++) {
      const louder = Math.max(channels[0].peaks[i], channels[1].peaks[i])
      expect(mono.peaks[i]).toBeLessThanOrEqual(louder + 1e-9)
    }
  })
})
