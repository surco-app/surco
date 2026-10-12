import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { NoiseMode, TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-noise-'))

const meta: TrackMetadata = {
  title: 'Noise',
  artist: 'Surface',
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

function source(name: string, expr: string): string {
  const path = join(dir, name)
  execFileSync(FF, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `aevalsrc=${expr}:s=44100:d=8`,
    '-c:a',
    'pcm_s16le',
    path,
  ])
  return path
}

// RMS of one band over the steady middle, past the filter's noise-learning head.
function bandDb(file: string, af: string): number {
  const raw = execFileSync(
    FF,
    ['-v', 'error', '-ss', '3', '-t', '4', '-i', file, '-af', af, '-f', 'f32le', '-'],
    { maxBuffer: 1024 * 1024 * 16 },
  )
  const s = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4)
  let sum = 0
  for (let i = 0; i < s.length; i++) sum += s[i] * s[i]
  return 10 * Math.log10(sum / s.length)
}

async function reduce(src: string, noise: NoiseMode): Promise<string> {
  const out = join(dir, `${noise}-${src.split('/').pop()}`)
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
    { mode: 'off', rumble: false, noise },
  )
  return out
}

const HIGHS = 'highpass=f=8000,highpass=f=8000,lowpass=f=16000'
const TONE = 'bandpass=f=1000:width_type=q:w=8'

// End-to-end through the real pipeline, on what a rip's breakdown looks like: a tone
// over a steady hiss floor.
describe('convertAudio background-noise reduction', () => {
  const hissy = source('hissy.wav', '0.25*sin(2*PI*1000*t)+0.002*(2*random(0)-1)')

  it('lowers the hiss floor more at every step', async () => {
    const floors = [bandDb(hissy, HIGHS)]
    for (const step of ['soft', 'medium', 'strong'] as const)
      floors.push(bandDb(await reduce(hissy, step), HIGHS))
    for (let i = 1; i < floors.length; i++) expect(floors[i]).toBeLessThan(floors[i - 1] - 1)
  }, 60000)

  it('leaves the music over the hiss as it was', async () => {
    const out = await reduce(hissy, 'strong')
    expect(Math.abs(bandDb(out, TONE) - bandDb(hissy, TONE))).toBeLessThan(0.5)
  }, 30000)

  // Switched on for a clean digital master by mistake, it must not touch it: the
  // reduction follows the track's own noise, and there is none to take.
  it('leaves a clean track without hiss untouched', async () => {
    const clean = source('clean.wav', '0.25*sin(2*PI*1000*t)+0.1*sin(2*PI*9000*t)')
    const out = await reduce(clean, 'strong')
    expect(Math.abs(bandDb(out, HIGHS) - bandDb(clean, HIGHS))).toBeLessThan(0.5)
  }, 30000)
})
