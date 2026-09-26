import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'
import { measureBands } from './fftBands'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-rate-response-'))
const src96 = join(dir, 'src96.flac')
const SECONDS = 20
const TOP_BANDS_HZ = [19500, 20000, 20500, 21000]

const meta: TrackMetadata = {
  title: '',
  artist: '',
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

async function topBands(file: string, rate: number): Promise<number[]> {
  const specs = [1000, ...TOP_BANDS_HZ].map((freqHz) => ({ freqHz, widthHz: 500 }))
  const rms = await measureBands(file, specs, rate, SECONDS)
  const ref = rms.get('1000x500') ?? Number.NaN
  return TOP_BANDS_HZ.map((f) => (rms.get(`${f}x500`) ?? Number.NaN) - ref)
}

function largestShift(before: number[], after: number[]): number {
  return Math.max(...after.map((db, i) => Math.abs(db - before[i])))
}

beforeAll(() => {
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `anoisesrc=d=${SECONDS}:c=white:a=0.05:r=96000`,
    '-c:a',
    'flac',
    '-sample_fmt',
    's32',
    src96,
  ])
}, 60000)

// A pinned output rate is a format choice, not an EQ. ffmpeg's default resampler filter
// (32 taps, cutoff at 97% of the new Nyquist) takes 4 dB off 21 kHz on the way from
// 96 kHz to 44.1, so every hi-res file brought down to CD rate came out with duller
// highs than the 44.1 kHz master of the same song, and a quality verdict that reads
// the top octave judged the resampler instead of the music.
describe('a pinned output sample rate', () => {
  it('brings 96 kHz down to 44.1 kHz with the top octave at its source level', async () => {
    const out = join(dir, 'out441.wav')
    await convertAudio(src96, out, 'wav', meta, undefined, undefined, undefined, {
      sampleRate: '44100',
    })
    const before = await topBands(src96, 96000)
    const after = await topBands(out, 44100)
    expect(largestShift(before, after)).toBeLessThan(0.3)
  }, 60000)
})
