import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import type { NormalizeConfig } from '../shared/types'
import { measureBands } from './fftBands'
import { limitedLoudnormFilter, loudnormFilter } from './normalize'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-normalize-response-'))
const src = join(dir, 'noise.wav')
const RATE = 44100
const SECONDS = 20
const TOP_BANDS_HZ = [19500, 20000, 20500, 21000]

const cfg: NormalizeConfig = { mode: 'loudness', targetLufs: -9, truePeakDb: -1, peakDb: -1 }
const measured = { inputI: -14, inputTp: -1.7, inputLra: 6, inputThresh: -24, targetOffset: 0 }

function render(filter: string, name: string): string {
  const out = join(dir, name)
  execFileSync(FF, ['-v', 'error', '-y', '-i', src, '-af', filter, '-c:a', 'pcm_f32le', out])
  return out
}

function largestShift(before: number[], after: number[]): number {
  return Math.max(...after.map((db, i) => Math.abs(db - before[i])))
}

async function topBands(file: string): Promise<number[]> {
  const specs = [1000, ...TOP_BANDS_HZ].map((freqHz) => ({ freqHz, widthHz: 500 }))
  const rms = await measureBands(file, specs, RATE, SECONDS)
  const ref = rms.get('1000x500') ?? Number.NaN
  return TOP_BANDS_HZ.map((f) => (rms.get(`${f}x500`) ?? Number.NaN) - ref)
}

beforeAll(() => {
  execFileSync(FF, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `anoisesrc=d=${SECONDS}:c=white:r=${RATE}:a=0.05`,
    '-c:a',
    'pcm_f32le',
    src,
  ])
})

// Normalizing is a level change, so it must leave the spectrum's shape alone. Both
// loudness paths leave the source rate and come back to it (loudnorm runs at 192 kHz,
// the limiter is oversampled 4x), and the resampler's default filter starts rolling
// off well inside the audible top octave: 3.5 dB gone at 20.5 kHz and 6 at 21. A user
// saw it as the quality verdict flipping on a normalized copy, because the tooth of a
// real enhancer saw-tooth at 20.5 kHz shrank under the bar; the highs lost from every
// normalized file are the same fault without a verdict to reveal it.
describe('loudness normalization frequency response', () => {
  it('keeps the top octave of a limited copy at its source level', async () => {
    const before = await topBands(src)
    const after = await topBands(render(limitedLoudnormFilter(cfg, measured, RATE), 'lim.wav'))
    expect(largestShift(before, after)).toBeLessThan(0.3)
  })

  it('keeps the top octave of a linearly normalized copy at its source level', async () => {
    const before = await topBands(src)
    const after = await topBands(render(loudnormFilter(cfg, measured, RATE), 'lin.wav'))
    expect(largestShift(before, after)).toBeLessThan(0.3)
  })
})
