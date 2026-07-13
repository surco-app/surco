// Reduces decoded mono PCM to a fixed number of peak buckets for drawing the
// track's waveform. Max-abs per bucket (not RMS/mean) because the display
// exists to line kicks up against the playhead: a transient is a few hot
// samples inside an otherwise quiet bucket, and any averaging would erase it.

// Sized for the editor strips' ×32 zoom: the trim handles are placed against the
// zoomed wave, and at 2048 buckets a deep zoom drew blocks instead of detail —
// "adjusting by eye" landed the cut tens of milliseconds off.
export const WAVEFORM_BUCKETS = 8192

// The rate ffmpeg decodes to for peak extraction. Far lower than the tempo
// rate because this decode is NOT bounded to the opening minutes — the strip
// spans the whole track — and a 2-hour mix at 11025 Hz would be a ~300 MB
// buffer. At 4 kHz each of the 8192 buckets still covers dozens of samples
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

// One channel's bucket-resolution wave: its own envelope and its own clip flags,
// so the split L/R view draws each lane from that channel's truth alone.
export interface ChannelWave {
  peaks: number[]
  clipped: boolean[]
}

// Streaming per-channel scanner fed interleaved f32 chunks straight off ffmpeg's
// stdout. Tracks the absolute sample index across pushes so a frame torn between two
// chunks keeps its channel phase. From the one native-rate pass it accumulates, per
// channel and per block, both the max-abs envelope (the split view's lanes) and the
// true-clipping flags — one pinned channel is clipping even when the other is clean,
// so the merged flags OR the channels together.
export function createChannelScan(
  channels: number,
  buckets = WAVEFORM_BUCKETS,
): {
  push: (chunk: Float32Array) => void
  finish: () => { clipped: boolean[]; channels: ChannelWave[] }
} {
  const blockMax: number[][] = Array.from({ length: channels }, () => [])
  const blockClip: boolean[][] = Array.from({ length: channels }, () => [])
  let samples = 0
  return {
    push(chunk: Float32Array): void {
      for (let i = 0; i < chunk.length; i++) {
        const sample = samples + i
        const ch = sample % channels
        const block = Math.floor(Math.floor(sample / channels) / CLIP_SCAN_BLOCK)
        const v = Math.abs(chunk[i])
        if (v > (blockMax[ch][block] ?? 0)) blockMax[ch][block] = v
        if (v >= CLIP_SAMPLE) blockClip[ch][block] = true
      }
      samples += chunk.length
    },
    finish(): { clipped: boolean[]; channels: ChannelWave[] } {
      const frames = Math.floor(samples / channels)
      const perChannel: ChannelWave[] = []
      for (let ch = 0; ch < channels; ch++) {
        const peaks = new Array<number>(buckets).fill(0)
        const clipped = new Array<boolean>(buckets).fill(false)
        if (frames > 0) {
          for (let b = 0; b < buckets; b++) {
            // The bucket's frame range, mapped to the blocks that overlap it — the
            // same integer-edge derivation as computePeaks so no tail is dropped.
            const startFrame = Math.floor((b * frames) / buckets)
            const endFrame = Math.max(startFrame, Math.floor(((b + 1) * frames) / buckets) - 1)
            const from = Math.floor(startFrame / CLIP_SCAN_BLOCK)
            const to = Math.floor(endFrame / CLIP_SCAN_BLOCK)
            let max = 0
            let clip = false
            for (let k = from; k <= to; k++) {
              const m = blockMax[ch][k]
              if (m !== undefined && m > max) max = m
              if (blockClip[ch][k]) clip = true
            }
            // Same clamp as computePeaks: hot lossy decodes overshoot ±1.0 and the
            // renderer scales bars by peak × lane height.
            peaks[b] = Math.min(max, 1)
            clipped[b] = clip
          }
        }
        perChannel.push({ peaks, clipped })
      }
      const clipped = new Array<boolean>(buckets).fill(false)
      for (let b = 0; b < buckets; b++) {
        clipped[b] = perChannel.some((ch) => ch.clipped[b])
      }
      return { clipped, channels: perChannel }
    },
  }
}
