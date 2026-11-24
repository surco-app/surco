import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { ConversionQuality, NormalizeConfig, TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const PROBE = ffprobeInstaller.path
const dir = mkdtempSync(join(tmpdir(), 'surco-keep-audio-'))

const meta: TrackMetadata = {
  title: 'New Title',
  artist: 'A',
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

// The settings that rewrite a same-format file: Corrected caps a 32-bit float file at the
// 24 bits CDJs load, and a pinned rate resamples a 48 kHz one.
const pins: Partial<ConversionQuality> = { bitDepth: 'corrected', sampleRate: '44100' }

let n = 0
function floatCopy(): string {
  const path = join(dir, `copy${n++}.wav`)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-ar',
    '48000',
    '-c:a',
    'pcm_f32le',
    path,
  ])
  return path
}

function streamOf(file: string): { codec: string; rate: number } {
  const s = JSON.parse(
    execFileSync(PROBE, [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=codec_name,sample_rate',
      '-of',
      'json',
      file,
    ]).toString(),
  ).streams[0]
  return { codec: s.codec_name, rate: Number(s.sample_rate) }
}

function retag(
  file: string,
  quality: Partial<ConversionQuality>,
  keepAudio: boolean,
  normalize?: NormalizeConfig,
) {
  return convertAudio(
    file,
    file,
    'wav',
    meta,
    undefined,
    normalize,
    undefined,
    quality,
    undefined,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    false,
    keepAudio,
  )
}

// Update on a library copy promises its audio stays: the DJ programs' cues, grids and
// analysis were made on those samples, so the quality pins must not reach them.
describe('convertAudio keeping the audio of a library copy', () => {
  it('rewrites a 32-bit float copy the pins would change, so the pins do reach a plain export', async () => {
    const file = floatCopy()
    await retag(file, pins, false)

    expect(streamOf(file)).not.toEqual({ codec: 'pcm_f32le', rate: 48000 })
  })

  it('stream-copies a 32-bit float 48 kHz copy whatever the pins say', async () => {
    const file = floatCopy()
    const { written } = await retag(file, pins, true)

    expect(streamOf(file)).toEqual({ codec: 'pcm_f32le', rate: 48000 })
    expect(written.plan.codec).toBe('copy')
  })

  it('fails and leaves the copy as it was rather than re-encode it', async () => {
    const file = floatCopy()
    const before = createHash('sha1').update(readFileSync(file)).digest('hex')
    await expect(
      retag(file, {}, true, { mode: 'peak', targetLufs: -9, truePeakDb: -1, peakDb: -1 }),
    ).rejects.toThrow('libraryCopyAudioWouldChange')

    expect(createHash('sha1').update(readFileSync(file)).digest('hex')).toBe(before)
  })
})
