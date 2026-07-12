import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-trim-'))
const src = join(dir, 'in.wav')
const loudHead = join(dir, 'in-loud-head.wav')

const meta: TrackMetadata = {
  title: 'Silence',
  artist: 'Needle',
  album: '',
  albumArtist: '',
  year: '',
  genre: '',
  grouping: '',
  comment: '',
  trackNumber: '',
  discNumber: '',
  bpm: '',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
}

function samplesOf(file: string): Float32Array {
  const raw = execFileSync(FF, ['-v', 'error', '-i', file, '-f', 'f32le', '-'], {
    maxBuffer: 1024 * 1024 * 64,
  })
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4)
}

function durationOf(file: string): number {
  return samplesOf(file).length / 44100
}

function peakOf(file: string): number {
  const s = samplesOf(file)
  let max = 0
  for (let i = 0; i < s.length; i++) {
    const a = Math.abs(s[i])
    if (a > max) max = a
  }
  return max
}

beforeAll(() => {
  // What a track split out of a vinyl-side rip looks like: a second of lead-in
  // groove, the music, a second of run-out before the next track's cue.
  execFileSync(FF, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'aevalsrc=if(between(t\\,1\\,3)\\,0.25*sin(2*PI*440*t)\\,0):s=44100:d=4',
    '-c:a',
    'pcm_s16le',
    src,
  ])
  // A loud needle-drop in the head that would anchor any measurement made on the
  // untrimmed file: 1 s at 0.9, then quiet music at 0.1.
  execFileSync(FF, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'aevalsrc=if(lt(t\\,1)\\,0.9\\,0.1)*sin(2*PI*440*t):s=44100:d=4',
    '-c:a',
    'pcm_s16le',
    loudHead,
  ])
})

// End-to-end through the real convertAudio pipeline and the bundled ffmpeg: the
// shared unit tests assert the filter strings, this asserts the samples written.
describe('convertAudio trim', () => {
  it('cuts the confirmed head and tail, re-encoding a same-format source', async () => {
    const out = join(dir, 'out.wav')
    await convertAudio(
      src,
      out,
      'wav',
      meta,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { startSec: 1, endSec: 3 },
    )
    // 4 s in, 2 s out — and a wav→wav conversion, so a stream copy would have
    // kept all 4 s: the trim must force the encode path.
    expect(durationOf(out)).toBeGreaterThan(1.9)
    expect(durationOf(out)).toBeLessThan(2.1)
  }, 30000)

  it('keeps the tail when only a start is confirmed', async () => {
    const out = join(dir, 'out-head-only.wav')
    await convertAudio(
      src,
      out,
      'wav',
      meta,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { startSec: 1 },
    )
    expect(durationOf(out)).toBeGreaterThan(2.9)
    expect(durationOf(out)).toBeLessThan(3.1)
  }, 30000)

  it('sizes a peak-normalize gain on the trimmed audio, not the cut head', async () => {
    const out = join(dir, 'out-normalized.wav')
    await convertAudio(
      loudHead,
      out,
      'wav',
      meta,
      undefined,
      { mode: 'peak', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { startSec: 1 },
    )
    // Measured through the 0.9 head the gain would be ~-1 dB and the remaining
    // quiet sine would land near 0.1; measured on the trimmed audio (peak 0.1)
    // it boosts the sine to the -1 dBFS target (~0.89).
    const peak = peakOf(out)
    expect(peak).toBeGreaterThan(0.6)
    expect(peak).toBeLessThan(0.95)
  }, 30000)
})
