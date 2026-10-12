import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-rumble-'))

const meta: TrackMetadata = {
  title: 'Rumble',
  artist: 'Platter',
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

// A stereo sine at `hz`, the right channel in anti-phase: that is how vinyl rumble
// arrives (the stylus moves vertically), so a test on a mono sum would cancel it away.
function sineFile(name: string, hz: number): string {
  const path = join(dir, name)
  execFileSync(FF, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `aevalsrc=0.3*sin(2*PI*${hz}*t)|-0.3*sin(2*PI*${hz}*t):s=44100:d=6`,
    '-c:a',
    'pcm_s16le',
    path,
  ])
  return path
}

// RMS of the steady middle, skipping the filter's settling at the head.
function rmsDb(file: string): number {
  const raw = execFileSync(
    FF,
    ['-v', 'error', '-ss', '2', '-t', '3', '-i', file, '-f', 'f32le', '-'],
    { maxBuffer: 1024 * 1024 * 16 },
  )
  const s = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4)
  let sum = 0
  for (let i = 0; i < s.length; i++) sum += s[i] * s[i]
  return 10 * Math.log10(sum / s.length)
}

async function cut(src: string, out: string): Promise<void> {
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
    { mode: 'off', noise: 'soft' },
  )
}

// End-to-end through the real pipeline: the rumble cut every background-noise step brings
// is said in the samples ffmpeg writes, not in the filter string. The gentlest step, so
// any change at 50 Hz is the cut's and not the denoiser's.
describe('convertAudio rumble cut', () => {
  it('takes the subsonic rumble out of the file', async () => {
    const src = sineFile('in-10hz.wav', 10)
    const out = join(dir, 'out-10hz.wav')
    await cut(src, out)
    expect(rmsDb(src) - rmsDb(out)).toBeGreaterThan(20)
  }, 30000)

  it('leaves a kick drum fundamental all but untouched', async () => {
    const src = sineFile('in-50hz.wav', 50)
    const out = join(dir, 'out-50hz.wav')
    await cut(src, out)
    expect(Math.abs(rmsDb(src) - rmsDb(out))).toBeLessThan(0.3)
  }, 30000)
})
