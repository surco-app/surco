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
// cost stops scaling with duration. The window length is set by what is NOT in
// every frame; see PROBE_SECONDS.

import { spawn } from 'node:child_process'
import { ffmpegPath } from './binaries'
import type { BandSpec } from './fftLevels'
import { runInWorker } from './worker'

export { type BandSpec, bandLevels, sliceLevels } from './fftLevels'

// Windows spread across the track. More stops changing the reading; fewer starts
// letting one quiet passage dominate.
const PROBE_POINTS = 12
// How long each window is. 0.75 s was enough for a codec wall, but two of the
// readings that ride on the same bands are not in every frame: the content above
// 22.05 kHz that decides the hi-res verdict comes in bursts (on a real 48 kHz
// master it swung the 23.5 kHz band 60 dB across the track), and the 1 dB rises
// the saw-tooth pass counts are the size of the sampling noise itself. So where
// the twelve windows landed decided the verdict: sliding the grid under one
// second moved the wall reading 3.7 to 17.5 dB across its 12 dB threshold, and a
// CD rip flipped between clean and "reprocessed" every 0.2 s of trimmed tail.
// Measured on those files, the readings settle to about 1 dB once 36 s of audio
// go in, and twelve windows of 3 s get there at the same concurrency; 6 s windows
// or 96 short ones buy nothing further.
const PROBE_SECONDS = 3
// Skip the intro and outro, where fades and silence carry no spectrum worth
// measuring. Proportional so it holds for a 30 s edit and a 10 min mix alike.
const BODY_START = 0.05
const BODY_END = 0.95
// Matches ANALYSIS_TIMEOUT_MS in ffmpeg.ts. Each probe decodes a few seconds of
// audio, so reaching this means the read is stuck rather than slow.
const PROBE_TIMEOUT_MS = 120_000

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
  const slices = await Promise.all(
    probeOffsets(durationSec).map((at) => decodeSlice(input, at, signal)),
  )
  return runInWorker<Map<string, number>>({ type: 'fftBands', slices, specs, sampleRateHz })
}
