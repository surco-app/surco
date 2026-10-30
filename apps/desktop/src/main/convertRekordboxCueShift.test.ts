import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({
  getSettings: () => ({ traktorNmlPath: '', traktorCueOffsetMs: 0 }),
}))
vi.mock('./rekordboxBatch', () => ({ recordRekordboxRepoint: vi.fn() }))

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'
import { recordRekordboxRepoint } from './rekordboxBatch'

// Reported 23/10 by a DJ ("the cues get lost on MP3s") and measured in the user's own
// rekordbox 24/10 on one LAME MP3 with hot cues set on the beat: once rekordbox analysed
// the converted file, every cue sat 51 ms after its kick following MP3→AIFF, 26 ms after an
// in-place MP3 re-encode, and well off the beat after trimming the start. The conversion is
// the only place that knows both files and the trim, so it is where the move is worked out.
const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-rbshift-'))
let lame: string

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

// ffmpeg's encoder writes the same Info/LAME tag layout a LAME-encoded download carries,
// encoder delay included, but signs it "Lavc". Re-signing it is what a Soulseek MP3 looks
// like to rekordboxTimeline.ts: 1152 + 576 + 529 samples, 51.18 ms at 44.1 kHz.
function lameMp3(path: string): void {
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=4:sample_rate=44100',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '320k',
    path,
  ])
  const bytes = readFileSync(path)
  const at = bytes.indexOf('Lavc', 0, 'latin1')
  bytes.write('LAME', at, 'latin1')
  writeFileSync(path, bytes)
}

function pcm(path: string, codec: string): void {
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2:sample_rate=44100',
    '-c:a',
    codec,
    path,
  ])
}

const recorded = () => vi.mocked(recordRekordboxRepoint).mock.calls.at(-1)?.[0]

beforeAll(() => {
  lame = join(dir, 'lame.mp3')
  lameMp3(lame)
})

beforeEach(() => {
  vi.mocked(recordRekordboxRepoint).mockClear()
})

describe('what a conversion tells rekordbox about its cues', () => {
  it('moves them by the start the LAME MP3 had over the AIFF', async () => {
    const src = join(dir, 'to-aiff.mp3')
    copyFileSync(lame, src)
    await convertAudio(src, join(dir, 'to-aiff.aiff'), 'aiff', meta)
    expect(recorded()?.audio).toEqual({ cueShiftMs: -51 })
  })

  // The source is overwritten by the rename, so its start has to be read before it.
  it('moves them by the start the original had over its in-place re-encode', async () => {
    const src = join(dir, 'in-place.mp3')
    copyFileSync(lame, src)
    await convertAudio(src, src, 'mp3', meta, undefined, {
      mode: 'peak',
      peakDb: -1,
      targetLufs: -14,
      truePeakDb: -1,
    })
    expect(recorded()).toMatchObject({ from: src, to: src, audio: { cueShiftMs: -25 } })
  })

  it('moves them back by the silence trimmed from the start', async () => {
    const src = join(dir, 'trimmed.mp3')
    copyFileSync(lame, src)
    await convertAudio(
      src,
      join(dir, 'trimmed.aiff'),
      'aiff',
      meta,
      undefined, // coverPath
      undefined, // normalize
      undefined, // removeCover
      undefined, // quality
      undefined, // onChild
      undefined, // onTmp
      undefined, // finderCovers
      undefined, // declick
      { startSec: 0.5 },
    )
    expect(recorded()?.audio).toEqual({ cueShiftMs: -551 })
  })

  // A same-format copy keeps the audio byte for byte, so the cues and rekordbox's analysis
  // still describe it.
  it('says nothing about the audio when the file is copied as it was', async () => {
    const src = join(dir, 'copied.mp3')
    copyFileSync(lame, src)
    await convertAudio(src, join(dir, 'copied-out.mp3'), 'mp3', meta)
    expect(recorded()).toBeDefined()
    expect(recorded()?.audio).toBeUndefined()
  })

  // Measured on a real track: AIFF→WAV decodes to the same samples, so the grid a DJ fixed by
  // hand and the cues still sit on the right sound and rekordbox must not reanalyse it.
  it.each([
    ['aiff', 'wav', 'pcm_s16be'],
    ['wav', 'aiff', 'pcm_s16le'],
    ['wav', 'flac', 'pcm_s16le'],
  ])('leaves the analysis and cues alone converting %s to %s', async (from, to, codec) => {
    const src = join(dir, `same-${from}-to-${to}.${from}`)
    pcm(src, codec)
    const out = join(dir, `same-${from}-to-${to}.${to}`)
    await convertAudio(src, out, to as 'wav' | 'aiff' | 'flac', meta)
    expect(recorded()).toMatchObject({ from: src, to: out })
    expect(recorded()?.audio).toBeUndefined()
  })

  it('still reports the audio when a lossy file is converted to WAV', async () => {
    const src = join(dir, 'lossy-to-wav.mp3')
    copyFileSync(lame, src)
    await convertAudio(src, join(dir, 'lossy-to-wav.wav'), 'wav', meta)
    expect(recorded()?.audio).toBeDefined()
  })
})
