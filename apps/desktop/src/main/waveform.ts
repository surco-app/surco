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

// Audacity's MAX_AUDIO: the int16 full-scale rail (32767/32768). A sample at or past
// this line is digital clipping; anything under it — however hot — is just loud
// mastering. Matching Audacity's constant makes our red marks agree with theirs.
export const CLIP_SAMPLE = 32767 / 32768

// Frames per accumulation block. Clipping is per-sample truth, so the scan can't run
// on the 4 kHz waveform decode (resampling smears flat tops and the mono downmix
// averages a pinned channel away) — it reads the native-rate stream instead, whose
// total frame count is unknown until it ends. Fixed-size blocks bridge that: flags
// accumulate per block while streaming, then map onto the buckets once the length is
// known. At 512 frames (~12 ms at 44.1 kHz) the bleed from a block straddling a
// bucket edge stays far below what a strip pixel can show.
const CLIP_SCAN_BLOCK = 512

// Streaming detector for true digital clipping, fed interleaved f32 chunks straight
// off ffmpeg's stdout. Tracks the absolute sample index across pushes so a frame torn
// between two chunks keeps its channel phase, and marks per-channel — one pinned
// channel is clipping even when the other is clean.
export function createClipScan(
  channels: number,
  buckets = WAVEFORM_BUCKETS,
): { push: (chunk: Float32Array) => void; finish: () => boolean[] } {
  const blocks: boolean[] = []
  let samples = 0
  return {
    push(chunk: Float32Array): void {
      for (let i = 0; i < chunk.length; i++) {
        const v = chunk[i]
        if (v >= CLIP_SAMPLE || v <= -CLIP_SAMPLE) {
          blocks[Math.floor(Math.floor((samples + i) / channels) / CLIP_SCAN_BLOCK)] = true
        }
      }
      samples += chunk.length
    },
    finish(): boolean[] {
      const frames = Math.floor(samples / channels)
      const flags = new Array<boolean>(buckets).fill(false)
      if (frames === 0) return flags
      for (let b = 0; b < blocks.length; b++) {
        if (!blocks[b]) continue
        const startFrame = b * CLIP_SCAN_BLOCK
        const endFrame = Math.min(frames - 1, startFrame + CLIP_SCAN_BLOCK - 1)
        const from = Math.min(buckets - 1, Math.floor((startFrame * buckets) / frames))
        const to = Math.min(buckets - 1, Math.floor((endFrame * buckets) / frames))
        for (let k = from; k <= to; k++) flags[k] = true
      }
      return flags
    },
  }
}
