// Reduces decoded mono PCM to a fixed number of peak buckets for drawing the
// track's waveform. Max-abs per bucket (not RMS/mean) because the display
// exists to line kicks up against the playhead: a transient is a few hot
// samples inside an otherwise quiet bucket, and any averaging would erase it.

// Sized for the editor strips' ×32 zoom: the trim handles are placed against the
// zoomed wave, and at 2048 buckets a deep zoom drew blocks instead of detail —
// "adjusting by eye" landed the cut tens of milliseconds off.
export const WAVEFORM_BUCKETS = 8192

// The rate the deep-zoom window decodes to. The whole-track envelope no longer uses it:
// it rides the native-rate scan (createChannelScan below), because the resample cost more
// than the decode it fed — and rounded transients off, reading a LOWER peak than the native
// pass in 8191 of 8192 buckets. The zoom window keeps it: that decode is a few seconds
// long, so the resample is cheap there, and it bounds the buffer for a window the user can
// scrub across quickly.
export const WAVEFORM_SAMPLE_RATE = 4000

// Alongside the max-abs envelope, each bucket carries its RMS: the Audacity-style
// two-layer draw (peak outline + solid RMS core) is what lets the eye tell a
// transient from sustained material — a single translucent layer flattens both
// into the same block. One pass over the PCM computes both.
export function computePeaks(
  samples: Float32Array,
  buckets = WAVEFORM_BUCKETS,
): { peaks: number[]; rms: number[] } {
  const count = Math.min(buckets, samples.length)
  const peaks = new Array<number>(count)
  const rms = new Array<number>(count)
  for (let b = 0; b < count; b++) {
    // Integer bucket edges derived per index so the last bucket always ends
    // exactly at samples.length — a fixed stride would drop a remainder tail.
    const start = Math.floor((b * samples.length) / count)
    const end = Math.floor(((b + 1) * samples.length) / count)
    let max = 0
    let sq = 0
    for (let i = start; i < end; i++) {
      const v = Math.abs(samples[i])
      if (v > max) max = v
      sq += v * v
    }
    // Float decodes of hot masters can overshoot ±1.0; the renderer multiplies
    // by bar height, so clamp rather than let one bucket draw off-canvas. The
    // RMS clamps to the clamped peak so the core never paints past its envelope.
    peaks[b] = Math.min(max, 1)
    rms[b] = Math.min(end > start ? Math.sqrt(sq / (end - start)) : 0, peaks[b])
  }
  return { peaks, rms }
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

// The mono envelope the strip draws, reduced from the same native pass as the lanes:
// max-abs peaks with an RMS body underneath, on the same bucket grid. frames is the
// decoded frame count, which the caller turns into durationSec — an exact sample-count
// duration rather than the container's, which can lie.
export interface MonoWave {
  peaks: number[]
  rms: number[]
}

// Blocks grow geometrically rather than one push at a time: a 2-hour mix is ~620k blocks
// per channel, and repeatedly growing a plain array reallocated the backing store on the
// hot path. Typed arrays also drop the `?? 0` guard every sample used to pay.
const BLOCK_GROWTH = 2
const INITIAL_BLOCKS = 1024

function grow(buf: Float32Array<ArrayBuffer>, need: number): Float32Array<ArrayBuffer> {
  if (need < buf.length) return buf
  let size = Math.max(buf.length * BLOCK_GROWTH, INITIAL_BLOCKS)
  while (size <= need) size *= BLOCK_GROWTH
  const next = new Float32Array(size)
  next.set(buf)
  return next
}

// Streaming per-channel scanner fed interleaved f32 chunks straight off ffmpeg's
// stdout. Tracks the absolute sample index across pushes so a frame torn between two
// chunks keeps its channel phase. From the one native-rate pass it accumulates, per
// channel and per block, the max-abs envelope (the split view's lanes), the
// true-clipping flags — one pinned channel is clipping even when the other is clean,
// so the merged flags OR the channels together — and the mono mix the strip draws,
// which used to cost a second full decode of the same file at 4 kHz.
//
// The mono accumulation averages the channels, matching what `-ac 1 -rematrix_maxval 1.0`
// produced: ffmpeg's power-preserving downmix would multiply two correlated channels by
// √2 (+3.01 dB), and every dB threshold downstream reads this envelope as the file's own
// level. Its RMS keeps a sum of squares AND a frame count per block, because a bucket
// spans a fractional number of blocks — dividing by a nominal block size instead would
// skew the body of every bucket whose edge falls mid-block.
export function createChannelScan(
  channels: number,
  buckets = WAVEFORM_BUCKETS,
): {
  push: (chunk: Float32Array) => void
  finish: () => { clipped: boolean[]; channels: ChannelWave[]; mono: MonoWave; frames: number }
} {
  const blockMax = Array.from({ length: channels }, () => new Float32Array(INITIAL_BLOCKS))
  const blockClip = Array.from({ length: channels }, () => new Uint8Array(INITIAL_BLOCKS))
  let monoMax = new Float32Array(INITIAL_BLOCKS)
  let monoSq = new Float64Array(INITIAL_BLOCKS)
  let monoCount = new Uint32Array(INITIAL_BLOCKS)
  let samples = 0
  // The block being filled, held open across pushes: its accumulators live in plain
  // numbers, not array slots. Reading and writing a typed array per sample — plus the
  // bounds check that guards growth — cost more than the decode itself (measured: 253 ms
  // of JS against a 78 ms native decode on a 5-minute FLAC). Accumulating in locals and
  // storing once per 512-frame block is the same arithmetic at a fifth of the price.
  let block = 0
  let blockFrames = 0
  const chMax = new Float64Array(channels)
  const chClip = new Uint8Array(channels)
  let mMax = 0
  let mSq = 0
  // A frame's samples arrive one at a time and can be torn across pushes, so the channel
  // cursor and the running mono sum both persist between calls.
  let ch = 0
  let frameSum = 0

  // Close the open block: one store per channel plus the mono trio, then reset the
  // registers for the next one. Growth is checked here — once per block, not per sample.
  function flushBlock(): void {
    if (block >= monoMax.length) {
      for (let c = 0; c < channels; c++) {
        blockMax[c] = grow(blockMax[c], block)
        const nextClip = new Uint8Array(blockMax[c].length)
        nextClip.set(blockClip[c])
        blockClip[c] = nextClip
      }
      monoMax = grow(monoMax, block)
      const nextSq = new Float64Array(monoMax.length)
      nextSq.set(monoSq)
      monoSq = nextSq
      const nextCount = new Uint32Array(monoMax.length)
      nextCount.set(monoCount)
      monoCount = nextCount
    }
    for (let c = 0; c < channels; c++) {
      blockMax[c][block] = chMax[c]
      blockClip[c][block] = chClip[c]
      chMax[c] = 0
      chClip[c] = 0
    }
    monoMax[block] = mMax
    monoSq[block] = mSq
    monoCount[block] = blockFrames
    mMax = 0
    mSq = 0
    blockFrames = 0
    block++
  }

  // One sample through the general path: any channel count, any alignment. Correct for
  // everything, and the only path a mono or surround file takes.
  function pushSample(raw: number): void {
    const v = raw < 0 ? -raw : raw
    if (v > chMax[ch]) chMax[ch] = v
    if (v >= CLIP_SAMPLE) chClip[ch] = 1
    frameSum += raw
    if (++ch === channels) {
      ch = 0
      const mixed = frameSum / channels
      const m = mixed < 0 ? -mixed : mixed
      if (m > mMax) mMax = m
      mSq += m * m
      frameSum = 0
      if (++blockFrames === CLIP_SCAN_BLOCK) flushBlock()
    }
  }

  return {
    push(chunk: Float32Array): void {
      samples += chunk.length
      // Stereo fast path — the shape virtually every track has. Holding both channels'
      // accumulators in locals across a whole block, instead of indexing chMax[ch] and
      // branching on the channel cursor once per sample, is a ~6× difference on the
      // reduction (24 ms against 142 ms on a 5-minute track), which is what makes one
      // native pass beat the 4 kHz decode it replaces rather than merely match it.
      // The general path still handles the edges: a chunk can start mid-frame or mid-block,
      // and the tail below the last whole block falls through to it.
      // Mono fast path: one sample IS one frame, so the mono mix is the sample itself and
      // the lane and the mix share a single max. Without this a mono file takes the general
      // path and lands slower than the 4 kHz decode this replaces.
      if (channels === 1) {
        let i = 0
        while (i < chunk.length) {
          const room = CLIP_SCAN_BLOCK - blockFrames
          const frames = Math.min(room, chunk.length - i)
          let cm = chMax[0]
          let cc = chClip[0]
          let mm = mMax
          let sq = mSq
          const end = i + frames
          for (; i < end; i++) {
            const raw = chunk[i]
            const v = raw < 0 ? -raw : raw
            if (v > cm) cm = v
            if (v >= CLIP_SAMPLE) cc = 1
            if (v > mm) mm = v
            sq += v * v
          }
          chMax[0] = cm
          chClip[0] = cc
          mMax = mm
          mSq = sq
          blockFrames += frames
          if (blockFrames === CLIP_SCAN_BLOCK) flushBlock()
        }
        return
      }
      if (channels === 2 && ch === 0) {
        let i = 0
        while (i + 1 < chunk.length) {
          const room = CLIP_SCAN_BLOCK - blockFrames
          const frames = Math.min(room, (chunk.length - i) >> 1)
          if (frames <= 0) break
          let lm = chMax[0]
          let rm = chMax[1]
          let lc = chClip[0]
          let rc = chClip[1]
          let mm = mMax
          let sq = mSq
          const end = i + frames * 2
          for (; i < end; i += 2) {
            const a = chunk[i]
            const b = chunk[i + 1]
            const av = a < 0 ? -a : a
            const bv = b < 0 ? -b : b
            if (av > lm) lm = av
            if (av >= CLIP_SAMPLE) lc = 1
            if (bv > rm) rm = bv
            if (bv >= CLIP_SAMPLE) rc = 1
            const mixed = (a + b) * 0.5
            const m = mixed < 0 ? -mixed : mixed
            if (m > mm) mm = m
            sq += m * m
          }
          chMax[0] = lm
          chMax[1] = rm
          chClip[0] = lc
          chClip[1] = rc
          mMax = mm
          mSq = sq
          blockFrames += frames
          if (blockFrames === CLIP_SCAN_BLOCK) flushBlock()
        }
        // A trailing odd sample leaves the frame half-open; the general path carries it
        // into the next chunk with the channel cursor set.
        for (; i < chunk.length; i++) pushSample(chunk[i])
        return
      }
      for (let i = 0; i < chunk.length; i++) pushSample(chunk[i])
    },
    finish(): {
      clipped: boolean[]
      channels: ChannelWave[]
      mono: MonoWave
      frames: number
    } {
      // The decode almost never ends on a block boundary, so the open block holds the
      // track's last ~12 ms: without this the tail would read as silence.
      if (blockFrames > 0) flushBlock()
      const frames = Math.floor(samples / channels)
      const perChannel: ChannelWave[] = []
      for (let c = 0; c < channels; c++) {
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
            for (let k = from; k <= to && k < blockMax[c].length; k++) {
              const m = blockMax[c][k]
              if (m > max) max = m
              if (blockClip[c][k]) clip = true
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
        clipped[b] = perChannel.some((c) => c.clipped[b])
      }
      const monoPeaks = new Array<number>(buckets).fill(0)
      const monoRms = new Array<number>(buckets).fill(0)
      if (frames > 0) {
        for (let b = 0; b < buckets; b++) {
          const startFrame = Math.floor((b * frames) / buckets)
          const endFrame = Math.max(startFrame, Math.floor(((b + 1) * frames) / buckets) - 1)
          const from = Math.floor(startFrame / CLIP_SCAN_BLOCK)
          const to = Math.floor(endFrame / CLIP_SCAN_BLOCK)
          let max = 0
          let sq = 0
          let count = 0
          for (let k = from; k <= to && k < monoMax.length; k++) {
            const m = monoMax[k]
            if (m > max) max = m
            sq += monoSq[k]
            count += monoCount[k]
          }
          const peak = Math.min(max, 1)
          monoPeaks[b] = peak
          // Clamped to the clamped peak, exactly as computePeaks does, so the solid core
          // never paints past the outline it sits inside.
          monoRms[b] = Math.min(count > 0 ? Math.sqrt(sq / count) : 0, peak)
        }
      }
      return { clipped, channels: perChannel, mono: { peaks: monoPeaks, rms: monoRms }, frames }
    },
  }
}
