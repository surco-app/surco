import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({
  getSettings: () => ({ traktorNmlPath: '', traktorCueOffsetMs: 0 }),
}))

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'

// The premise the encoder-delay compensation was built on, put under measurement.
//
// It was measured on 2026-09-06 by encoding one WAV twice, with and without the
// Xing/LAME header, and comparing the two MP3s to each other: the header-less one
// came back 1105 samples later. That number then became a correction applied to
// CONVERSIONS — but the two files in that comparison are not a conversion. 1105 is
// 529 + 576, the encoder priming plus the MDCT half-overlap, and the 576 only appears
// because the two encodes were compared against each other rather than one file being
// followed through a conversion.
//
// What a conversion actually does to the audio is what this file measures, on the
// sample. If any crossing moved the audio, a cue carried across would need to move
// with it, and the compensation would be justified. None does.
const FF = ffmpegStatic as unknown as string
const SR = 44100
const CLICK_SEC = 5
const dir = mkdtempSync(join(tmpdir(), 'surco-noshift-'))

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
  bpm: '128',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
}

// Silence carrying one full-scale sample, so "where is the audio" has a single
// unambiguous answer that survives a lossy round trip.
function makeClick(path: string, extra: string[] = []): void {
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `aevalsrc=0:d=10:s=${SR}`,
    '-af',
    `volume=0,aeval='if(eq(floor(t*${SR}),${CLICK_SEC * SR}),1,0)'`,
    '-ar',
    String(SR),
    '-ac',
    '1',
    ...extra,
    path,
  ])
}

// Position of the loudest sample, in milliseconds, after decoding to raw floats.
function peakMs(file: string): number {
  const raw = join(dir, `peak-${Math.random().toString(36).slice(2)}.f32`)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-i',
    file,
    '-f',
    'f32le',
    '-ac',
    '1',
    '-ar',
    String(SR),
    raw,
  ])
  const buf = readFileSync(raw)
  let best = 0
  let bestAt = -1
  for (let i = 0; i + 4 <= buf.length; i += 4) {
    const v = Math.abs(buf.readFloatLE(i))
    if (v > best) {
      best = v
      bestAt = i / 4
    }
  }
  return (bestAt / SR) * 1000
}

const sources: { label: string; path: string }[] = []

beforeAll(() => {
  for (const [label, name, extra] of [
    ['FLAC', 'src.flac', []],
    ['WAV', 'src.wav', []],
    ['AIFF', 'src.aiff', []],
    ['MP3 with a Xing header', 'src-xing.mp3', []],
    ['MP3 with its Xing header stripped', 'src-noxing.mp3', ['-write_xing', '0']],
  ] as const) {
    const path = join(dir, name)
    makeClick(path, [...extra])
    sources.push({ label, path })
  }
})

const TARGETS = [
  { format: 'flac', ext: '.flac' },
  { format: 'mp3', ext: '.mp3' },
  { format: 'aiff', ext: '.aiff' },
  { format: 'wav', ext: '.wav' },
] as const

describe('a conversion never moves the audio', () => {
  for (const src of ['FLAC', 'WAV', 'AIFF', 'MP3 with a Xing header'] as const) {
    for (const target of TARGETS) {
      it(`keeps the click where it was from ${src} to ${target.ext}`, async () => {
        const source = sources.find((s) => s.label === src) as { label: string; path: string }
        const out = join(dir, `${src.replace(/ /g, '_')}${target.ext}`)
        await convertAudio(source.path, out, target.format, meta)
        expect(peakMs(out)).toBeCloseTo(peakMs(source.path), 1)
      })
    }
  }

  // The population the compensation exists for. Its audio sits 529 samples late
  // relative to a re-headered copy of ITSELF — that offset is already baked into the
  // file, present before any conversion and identical after one. A conversion inherits
  // it rather than adding to it, so there is nothing for the converter to correct: the
  // cues Traktor wrote were placed against this same decoded audio.
  for (const target of TARGETS) {
    it(`keeps the click where it was from a header-stripped MP3 to ${target.ext}`, async () => {
      const source = sources.find((s) => s.label === 'MP3 with its Xing header stripped') as {
        label: string
        path: string
      }
      const out = join(dir, `stripped${target.ext}`)
      await convertAudio(source.path, out, target.format, meta)
      expect(peakMs(out)).toBeCloseTo(peakMs(source.path), 1)
    })
  }
})
