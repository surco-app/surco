import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { NormalizeConfig, TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-lossyceiling-'))
const hats = join(dir, 'hats.wav')

const meta: TrackMetadata = {
  title: 'Hats',
  artist: 'Test',
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

function truePeakDb(file: string): number {
  const run = spawnSync(
    FF,
    ['-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
    {
      encoding: 'utf-8',
    },
  )
  const m = run.stderr.slice(run.stderr.lastIndexOf('True peak:')).match(/Peak:\s*(-?[\d.]+)/)
  return Number(m?.[1])
}

// Bright transient bursts over a bass tone. Measured with ffmpeg-static's libmp3lame, a
// constant gain that puts this signal's true peak on -1.0 dBTP comes out of 128 kbps at
// -0.6; held at -1.0 by the limiter at a -9 LUFS target, 320 kbps comes out at +0.4 and
// the lossless render at 0.0. On a real track (the guide's reference WAV, 60 s at its
// loudest) the constant gain came out at -0.7 at 320 kbps, -0.9 at V0 and +0.7 at 128
// kbps; a DJ reported the same -0.7 at 320 kbps from the field.
beforeAll(() => {
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=c=white:a=0.5:d=20:r=44100:seed=1',
    '-f',
    'lavfi',
    '-i',
    'sine=f=110:d=20:r=44100',
    '-filter_complex',
    "[0]highpass=f=3000,volume='if(lt(mod(t,0.25),0.03),1,0.1)':eval=frame[h];[1]volume=0.5[b];[h][b]amix=inputs=2:normalize=0,pan=stereo|c0=c0|c1=0.9*c0",
    hats,
  ])
})

const MP3_320 = {
  mp3Quality: '320',
  bitDepth: 'source',
  sampleRate: 'source',
  flacCompression: '5',
} as const

const loudness = (targetLufs: number): NormalizeConfig => ({
  mode: 'loudness',
  targetLufs,
  truePeakDb: -1,
  peakDb: -1,
})

// The ceiling is a promise about the file the DJ plays, not about the audio before the
// encoder: an MP3 that lands above it is exactly the clipping-on-the-club-system risk the
// setting exists to prevent.
describe('an MP3 normalized to a true-peak ceiling', () => {
  it('stays under the ceiling when a constant gain alone would land the peaks just under it', async () => {
    const out = join(dir, 'linear.mp3')
    await convertAudio(hats, out, 'mp3', meta, undefined, loudness(-14.5), undefined, {
      ...MP3_320,
      mp3Quality: '128',
    })
    expect(truePeakDb(out)).toBeLessThanOrEqual(-1)
  }, 60000)

  it('stays under the ceiling when the limiter holds the peaks', async () => {
    const out = join(dir, 'limited.mp3')
    await convertAudio(hats, out, 'mp3', meta, undefined, loudness(-9), undefined, {
      ...MP3_320,
    })
    expect(truePeakDb(out)).toBeLessThanOrEqual(-1)
  }, 60000)

  it('stays under the ceiling at a low bitrate, where the encoder overshoots the most', async () => {
    const out = join(dir, 'low.mp3')
    await convertAudio(hats, out, 'mp3', meta, undefined, loudness(-9), undefined, {
      ...MP3_320,
      mp3Quality: '128',
    })
    expect(truePeakDb(out)).toBeLessThanOrEqual(-1)
  }, 60000)
})
