import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const PROBE = ffprobeInstaller.path
const dir = mkdtempSync(join(tmpdir(), 'surco-corrected-'))
const src441 = join(dir, 'src441.wav')
const up48 = join(dir, 'up48.flac')
const native48 = join(dir, 'native48.flac')

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

function rateOf(file: string): number {
  const out = execFileSync(PROBE, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=sample_rate',
    '-of',
    'default=nw=1:nk=1',
    file,
  ])
  return Number(out.toString().trim())
}

beforeAll(() => {
  // Broadband noise born at 44.1 kHz (content to 22.05), then upsampled to 48:
  // the resampler leaves the textbook wall the corrected policy acts on. The
  // native 48 kHz noise carries real content to 24 kHz and must be left alone.
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=d=4:a=0.3:r=44100',
    '-c:a',
    'pcm_s16le',
    src441,
  ])
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-i',
    src441,
    '-ar',
    '48000',
    '-c:a',
    'flac',
    '-sample_fmt',
    's32',
    up48,
  ])
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=d=4:a=0.3:r=48000',
    '-c:a',
    'flac',
    '-sample_fmt',
    's32',
    native48,
  ])
}, 60000)

describe("the 'corrected' output sample rate", () => {
  it('writes a proven 44.1-to-48 upsample back at 44.1 kHz', async () => {
    const out = join(dir, 'out-up.aiff')
    await convertAudio(up48, out, 'aiff', meta, undefined, undefined, undefined, {
      sampleRate: 'corrected',
    })
    expect(rateOf(out)).toBe(44100)
  }, 30000)

  it('leaves genuine 48 kHz content at its own rate', async () => {
    const out = join(dir, 'out-native.aiff')
    await convertAudio(native48, out, 'aiff', meta, undefined, undefined, undefined, {
      sampleRate: 'corrected',
    })
    expect(rateOf(out)).toBe(48000)
  }, 30000)

  it('never touches a 44.1 kHz source, with no measurement spent on it', async () => {
    const out = join(dir, 'out-441.aiff')
    await convertAudio(src441, out, 'aiff', meta, undefined, undefined, undefined, {
      sampleRate: 'corrected',
    })
    expect(rateOf(out)).toBe(44100)
  }, 30000)
})
