// Reduces decoded mono PCM to a fixed number of peak buckets for drawing the
// track's waveform. Max-abs per bucket (not RMS/mean) because the display
// exists to line kicks up against the playhead: a transient is a few hot
// samples inside an otherwise quiet bucket, and any averaging would erase it.

export const WAVEFORM_BUCKETS = 2048

// The rate ffmpeg decodes to for peak extraction. Far lower than the tempo
// rate because this decode is NOT bounded to the opening minutes — the strip
// spans the whole track — and a 2-hour mix at 11025 Hz would be a ~300 MB
// buffer. At 4 kHz each of the 2048 buckets still covers hundreds of samples
// on a club track, so kick transients survive the max-abs reduction intact.
export const WAVEFORM_SAMPLE_RATE = 4000

export function computePeaks(samples: Float32Array, buckets = WAVEFORM_BUCKETS): number[] {
  const count = Math.min(buckets, samples.length)
  const peaks = new Array<number>(count)
  for (let b = 0; b < count; b++) {
    // Integer bucket edges derived per index so the last bucket always ends
    // exactly at samples.length — a fixed stride would drop a remainder tail.
    const start = Math.floor((b * samples.length) / count)
    const end = Math.floor(((b + 1) * samples.length) / count)
    let max = 0
    for (let i = start; i < end; i++) {
      const v = Math.abs(samples[i])
      if (v > max) max = v
    }
    // Float decodes of hot masters can overshoot ±1.0; the renderer multiplies
    // by bar height, so clamp rather than let one bucket draw off-canvas.
    peaks[b] = Math.min(max, 1)
  }
  return peaks
}
