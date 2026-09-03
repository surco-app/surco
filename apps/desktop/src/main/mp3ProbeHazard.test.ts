import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { forcedInputArgs } from '../shared/inputFormat'
import type { TrackMetadata } from '../shared/types'
import { runChannelScan } from './channelScan'
import {
  assertDecodable,
  convertAudio,
  generateSpectrogram,
  measureLoudness,
  probeAudio,
} from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-probe-hazard-'))
const adversarial = join(dir, 'adversarial.mp3')

const meta: TrackMetadata = {
  title: 'T',
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

// A perfectly valid MP3 that ffmpeg's format detection misreads as an MPEG program
// stream (upstream trac #336): a user's real conversion came out with one 00 00 01 E0
// byte run per frame in LAME's ancillary bits, and behind its ~250KB cover tag the
// probe window kept so little audio that those pseudo-PES codes outscored mp3. Every
// player read the file fine; every one of Surco's ffmpeg-based reads failed on it.
// This fixture rebuilds that shape deterministically: a quiet CBR-320 tone, the same
// PES-looking run patched into each frame's stuffing region, behind a ~248KB tag.
beforeAll(() => {
  const plain = join(dir, 'plain.mp3')
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=44100:duration=5',
    '-af',
    'volume=0.001,pan=stereo|c0=c0|c1=c0',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '320k',
    '-id3v2_version',
    '0',
    plain,
  ])
  const audio = Buffer.from(readFileSync(plain))
  const frame = 1044
  let patched = 0
  let i = 0
  while (i + frame + 8 < audio.length && patched < 60) {
    if (audio[i] === 0xff && (audio[i + 1] & 0xe0) === 0xe0) {
      Buffer.from([0x00, 0x00, 0x01, 0xe0, 0x00, 0x07, 0x80, 0x00, 0x00]).copy(
        audio,
        i + frame - 60,
      )
      patched += 1
      i += frame
    } else {
      i += 1
    }
  }
  expect(patched).toBe(60)
  const cover = join(dir, 'cover.jpg')
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=64x64:d=1',
    '-frames:v',
    '1',
    cover,
  ])
  const jpeg = readFileSync(cover)
  const apicBody = Buffer.concat([
    Buffer.from('\x00image/jpeg\x00\x03cover\x00', 'latin1'),
    jpeg,
    Buffer.alloc(248000 - jpeg.length, 0x20),
  ])
  const apic = Buffer.concat([
    Buffer.from('APIC'),
    (() => {
      const b = Buffer.alloc(4)
      b.writeUInt32BE(apicBody.length)
      return b
    })(),
    Buffer.from([0, 0]),
    apicBody,
  ])
  const size = apic.length
  const syncsafe = Buffer.from([
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f,
  ])
  const tag = Buffer.concat([Buffer.from('ID3\x03\x00\x00', 'latin1'), syncsafe, apic])
  writeFileSync(adversarial, Buffer.concat([tag, audio]))
})

describe('forcedInputArgs', () => {
  // Only .mp3 needs the demuxer pinned: every other supported container opens with an
  // unambiguous magic number, and forcing a format on them would break nothing-but-risk.
  it('forces the mp3 demuxer for .mp3 paths, case-insensitively', () => {
    expect(forcedInputArgs('/a/b.mp3')).toEqual(['-f', 'mp3'])
    expect(forcedInputArgs('/a/B.MP3')).toEqual(['-f', 'mp3'])
  })

  it('leaves every other extension to ffmpeg detection', () => {
    expect(forcedInputArgs('/a/b.flac')).toEqual([])
    expect(forcedInputArgs('/a/b.wav')).toEqual([])
  })
})

describe('reading an mp3 whose bytes fool ffmpeg format detection', () => {
  it('probes the real stream parameters', async () => {
    const probe = await probeAudio(adversarial)
    expect(probe.codecName).toBe('mp3')
    expect(probe.sampleRate).toBe('44100')
  })

  it('measures loudness instead of failing the pass', async () => {
    const result = await measureLoudness(adversarial)
    expect(result).not.toBeNull()
    expect(result?.integratedLufs).toBeGreaterThan(-80)
    expect(result?.integratedLufs).toBeLessThan(-30)
  })

  it('scans the channels natively', async () => {
    const scan = await runChannelScan(adversarial, FF, 2, 60000)
    expect(scan.frames).toBeGreaterThan(0)
  })

  it('renders the spectrogram', async () => {
    const png = await generateSpectrogram(adversarial, 44100)
    expect(png.startsWith('data:image/png;base64,')).toBe(true)
    expect(png.length).toBeGreaterThan(100)
  })

  it('passes the converted-output decode check', async () => {
    await expect(assertDecodable(adversarial)).resolves.toBeUndefined()
  })

  it('converts to another format', async () => {
    const out = join(dir, 'out.flac')
    await convertAudio(adversarial, out, 'flac', meta)
    expect(existsSync(out)).toBe(true)
    const probe = await probeAudio(out)
    expect(probe.codecName).toBe('flac')
  })
})
