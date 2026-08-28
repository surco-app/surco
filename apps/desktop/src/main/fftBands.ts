// Measures the energy in high-frequency bands from the audio itself, by FFT.
//
// This replaces a filter bank (one `bandpass` branch per band, read through
// `astats`). That probe was measuring itself as much as the audio: on white
// noise, which is flat by definition, it reported a 11.2 dB fall by 21 kHz —
// its own IIR rolloff. Against lowpasses applied at a known frequency it landed
// 2.9 kHz off on average, always in the direction of calling a file cleaner than
// it is; a track brickwalled at 14 kHz still read as "cut at 20 kHz". An FFT bin
// has no such skirt: the same test lands within one band, and reads flat noise
// flat (±0.06 dB).
//
// The transform runs over a sample of the track rather than all of it. A codec
// wall is present in every frame, so ~12 windows spread across the body measure
// it as well as a full pass (verified: identical verdicts, same error), and the
// cost stops scaling with duration.

import { spawn } from 'node:child_process'
import { ffmpegPath } from './binaries'

// 4096 at 44.1 kHz puts ~10.8 Hz in a bin, so even the 500 Hz fine bands span
// dozens of them. The same size Spek, AudioAuditor and AVIL all settled on.
const FFT_SIZE = 4096
const HOP = FFT_SIZE / 2
// Windows spread across the track. More stops changing the reading; fewer starts
// letting one quiet passage dominate.
const PROBE_POINTS = 12
const PROBE_SECONDS = 0.75
// Skip the intro and outro, where fades and silence carry no spectrum worth
// measuring. Proportional so it holds for a 30 s edit and a 10 min mix alike.
const BODY_START = 0.05
const BODY_END = 0.95
// Below this a window is silence or near it; its spectrum is the noise floor and
// would drag the average down for every band equally.
const SILENCE_RMS = 1e-4
// Matches ANALYSIS_TIMEOUT_MS in ffmpeg.ts. Each probe decodes under a second of
// audio, so reaching this means the read is stuck rather than slow.
const PROBE_TIMEOUT_MS = 120_000

export interface BandSpec {
  freqHz: number
  widthHz: number
}

// In-place iterative radix-2 Cooley-Tukey. The input is real, so the caller
// leaves `im` zeroed and reads only the first half of the output.
function transform(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    const half = len / 2
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < half; k++) {
        const ur = re[i + k]
        const ui = im[i + k]
        const vr = re[i + k + half] * cr - im[i + k + half] * ci
        const vi = re[i + k + half] * ci + im[i + k + half] * cr
        re[i + k] = ur + vr
        im[i + k] = ui + vi
        re[i + k + half] = ur - vr
        im[i + k + half] = ui - vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

function hannWindow(size: number): { window: Float64Array; power: number } {
  const window = new Float64Array(size)
  for (let i = 0; i < size; i++) window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)))
  let power = 0
  for (let i = 0; i < size; i++) power += window[i] * window[i]
  return { window, power: power / size }
}

// The seek offsets to probe, spread across the body of the track. Exported so a
// test can pin the spread without decoding anything.
export function probeOffsets(durationSec: number, points = PROBE_POINTS): number[] {
  if (!(durationSec > 0)) return [0]
  const start = durationSec * BODY_START
  const end = durationSec * BODY_END
  if (end <= start) return [0]
  const offsets: number[] = []
  for (let i = 0; i < points; i++) offsets.push(start + ((end - start) * i) / points)
  return offsets
}

// Turns accumulated per-bin power into one mean level per requested band.
// Exported for tests: the dB conversion is where a normalisation slip would hide.
export function bandLevels(
  power: Float64Array,
  frames: number,
  specs: BandSpec[],
  sampleRateHz: number,
  windowPower: number,
): Map<string, number> {
  const levels = new Map<string, number>()
  if (frames === 0) return levels
  const binHz = sampleRateHz / FFT_SIZE
  const lastBin = power.length - 1
  for (const { freqHz, widthHz } of specs) {
    const lo = Math.max(0, Math.round((freqHz - widthHz / 2) / binHz))
    const hi = Math.min(lastBin, Math.round((freqHz + widthHz / 2) / binHz))
    if (hi < lo) {
      levels.set(`${freqHz}x${widthHz}`, Number.NEGATIVE_INFINITY)
      continue
    }
    let sum = 0
    for (let bin = lo; bin <= hi; bin++) sum += power[bin]
    const mean = sum / (hi - lo + 1) / frames
    // ×2 folds in the negative-frequency half of a real signal; dividing by
    // FFT_SIZE² and the window's power puts the result on the same dBFS scale
    // ffmpeg's own RMS readings use, so thresholds stay comparable.
    const scaled = (mean * 2) / (FFT_SIZE * FFT_SIZE * windowPower)
    levels.set(`${freqHz}x${widthHz}`, 10 * Math.log10(scaled + Number.MIN_VALUE))
  }
  return levels
}

function decodeSlice(input: string, at: number, signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // -ss before -i seeks by keyframe without decoding what it skips, which is
    // what keeps the cost flat regardless of how long the track is.
    const proc = spawn(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        at.toFixed(3),
        '-t',
        String(PROBE_SECONDS),
        '-i',
        input,
        '-map',
        '0:a:0',
        '-ac',
        '1',
        '-f',
        'f32le',
        '-',
      ],
      // Killed after the same budget the other analysis reads use: a probe that
      // stalls (an unresponsive network share, a malformed stream ffmpeg keeps
      // chewing on) must not hold its slot open forever.
      { stdio: ['ignore', 'pipe', 'pipe'], signal, timeout: PROBE_TIMEOUT_MS },
    )
    const chunks: Buffer[] = []
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => chunks.push(d))
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      // A probe that lands past the end of a stream yields nothing; that is not a
      // failure, the remaining points still carry the measurement.
      if (code === 0 || chunks.length) resolve(Buffer.concat(chunks))
      else reject(new Error(stderr.trim() || `ffmpeg exited ${code}`))
    })
  })
}

// Per-band levels (dB) for one file, sampled across its body.
export async function measureBands(
  input: string,
  specs: BandSpec[],
  sampleRateHz: number,
  durationSec: number,
  signal?: AbortSignal,
): Promise<Map<string, number>> {
  const { window, power: windowPower } = hannWindow(FFT_SIZE)
  const bins = FFT_SIZE / 2 + 1
  const acc = new Float64Array(bins)
  const re = new Float64Array(FFT_SIZE)
  const im = new Float64Array(FFT_SIZE)
  let frames = 0

  const slices = await Promise.all(
    probeOffsets(durationSec).map((at) => decodeSlice(input, at, signal)),
  )

  for (const slice of slices) {
    const samples = Math.floor(slice.length / 4)
    for (let base = 0; base + FFT_SIZE <= samples; base += HOP) {
      let energy = 0
      for (let i = 0; i < FFT_SIZE; i++) {
        const v = slice.readFloatLE((base + i) * 4)
        re[i] = v * window[i]
        im[i] = 0
        energy += v * v
      }
      if (Math.sqrt(energy / FFT_SIZE) < SILENCE_RMS) continue
      transform(re, im)
      for (let bin = 0; bin < bins; bin++) acc[bin] += re[bin] * re[bin] + im[bin] * im[bin]
      frames++
    }
  }

  return bandLevels(acc, frames, specs, sampleRateHz, windowPower)
}
