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
const dir = mkdtempSync(join(tmpdir(), 'surco-depth-'))
const src = join(dir, 'in.flac')

const meta: TrackMetadata = {
  title: 'Till I Come',
  artist: 'ATB',
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

function depthOf(file: string): { sampleFmt: string; bits: number; rate: number } {
  const out = execFileSync(PROBE, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=sample_fmt,bits_per_raw_sample,sample_rate',
    '-of',
    'json',
    file,
  ]).toString()
  const s = JSON.parse(out).streams[0]
  return {
    sampleFmt: s.sample_fmt,
    bits: Number(s.bits_per_raw_sample) || 0,
    rate: Number(s.sample_rate),
  }
}

beforeAll(() => {
  // A 44.1 kHz / 16-bit FLAC — the exact source shape users reported coming out 24-bit.
  execFileSync(FF, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-sample_fmt',
    's16',
    src,
  ])
})

// End-to-end regression guard for the reported 16→24 widening, through the real
// convertAudio pipeline and the bundled ffmpeg: the normalize filters hand the
// encoder float samples, and without the -sample_fmt pin FLAC/ALAC pick their
// widest input format. The unit tests assert the planned flags; this asserts the
// bytes ffmpeg actually writes.
describe('convertAudio output bit depth', () => {
  // "Same as source" means the width the audio really has, not the container's
  // claim: a proven 16-in-24 padding converts to honest 16-bit, and dropping
  // all-zero bits is mathematically lossless, so no dither rides along.
  it('writes a padded 16-in-24 source as true 16-bit under Same as source', async () => {
    const padded = join(dir, 'padded24.flac')
    execFileSync(FF, ['-y', '-v', 'error', '-i', src, '-c:a', 'flac', '-sample_fmt', 's32', padded])
    const out = join(dir, 'out-padded.wav')
    await convertAudio(padded, out, 'wav', meta)
    // ffprobe reports no bits_per_raw_sample for 16-bit PCM in WAV/AIFF, so the
    // sample format is the honest witness here.
    expect(depthOf(out).sampleFmt).toBe('s16')
  }, 30000)

  it('keeps genuinely 24-bit audio at 24 bits under Same as source', async () => {
    const noisy = join(dir, 'true24.flac')
    execFileSync(FF, [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'anoisesrc=d=3:a=0.3',
      '-c:a',
      'flac',
      '-sample_fmt',
      's32',
      noisy,
    ])
    const out = join(dir, 'out-true24.aiff')
    await convertAudio(noisy, out, 'aiff', meta)
    expect(depthOf(out).bits).toBe(24)
  }, 30000)

  it('keeps a normalized 44.1/16 source at 16 bits in FLAC', async () => {
    const out = join(dir, 'out.flac')
    await convertAudio(src, out, 'flac', meta, undefined, {
      mode: 'peak',
      targetLufs: -14,
      truePeakDb: -1,
      peakDb: -1,
    })
    expect(depthOf(out)).toEqual({ sampleFmt: 's16', bits: 16, rate: 44100 })
  }, 30000)

  it('keeps a normalized 44.1/16 source at 16 bits in ALAC', async () => {
    const out = join(dir, 'out.m4a')
    await convertAudio(src, out, 'alac', meta, undefined, {
      mode: 'peak',
      targetLufs: -14,
      truePeakDb: -1,
      peakDb: -1,
    })
    expect(depthOf(out)).toEqual({ sampleFmt: 's16p', bits: 16, rate: 44100 })
  }, 30000)

  it('honours a pinned 16-bit depth when converting to WAV', async () => {
    const wide = join(dir, 'in24.flac')
    execFileSync(FF, ['-y', '-i', src, '-sample_fmt', 's32', wide])
    const out = join(dir, 'out16.wav')
    await convertAudio(wide, out, 'wav', meta, undefined, undefined, undefined, {
      bitDepth: '16',
    })
    expect(depthOf(out).sampleFmt).toBe('s16')
  }, 30000)
})
