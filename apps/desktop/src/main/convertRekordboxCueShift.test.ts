import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
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
const PROBE = ffprobeInstaller.path
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

  // Measured in rekordbox 7 on 31/10: an ALAC .m4a, from ffmpeg or from Apple, put its first
  // beat at the same millisecond as the AIFF it was made from, so it is one more PCM format.
  it.each([
    ['wav', 'alac', 'pcm_s16le', 'm4a'],
    ['m4a', 'wav', 'alac', 'wav'],
  ])('leaves the analysis and cues alone converting %s to %s', async (from, to, codec, ext) => {
    const src = join(dir, `alac-${from}-to-${to}.${from}`)
    pcm(src, codec)
    await convertAudio(
      src,
      join(dir, `alac-${from}-to-${to}-out.${ext}`),
      to as 'wav' | 'alac',
      meta,
    )
    expect(recorded()).toBeDefined()
    expect(recorded()?.audio).toBeUndefined()
  })

  // The same session measured an AAC that ffmpeg encodes 23 ms late in rekordbox, the 1024
  // samples of priming its edit list declares, not the 48 ms of Apple's 2112.
  it('moves the cues by the priming an ffmpeg AAC declares converting it to WAV', async () => {
    const src = join(dir, 'aac-to-wav.m4a')
    pcm(src, 'aac')
    await convertAudio(src, join(dir, 'aac-to-wav.wav'), 'wav', meta)
    expect(recorded()?.audio).toEqual({ cueShiftMs: -23 })
  })

  // Trimming or normalizing changes the samples between two lossless formats, so rekordbox
  // has to reanalyse and the cues have to follow the trim.
  it('still reports the audio when a lossless conversion is trimmed', async () => {
    const src = join(dir, 'trim-wav-to-flac.wav')
    pcm(src, 'pcm_s16le')
    await convertAudio(
      src,
      join(dir, 'trim-wav-to-flac.flac'),
      'flac',
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
    expect(recorded()?.audio).toEqual({ cueShiftMs: -500 })
  })

  it('still reports the audio when a lossless conversion is normalized', async () => {
    const src = join(dir, 'normalized-wav-to-aiff.wav')
    pcm(src, 'pcm_s16le')
    await convertAudio(src, join(dir, 'normalized-wav-to-aiff.aiff'), 'aiff', meta, undefined, {
      mode: 'peak',
      peakDb: -1,
      targetLufs: -14,
      truePeakDb: -1,
    })
    expect(recorded()?.audio).toEqual({ cueShiftMs: 0 })
  })

  it('still reports the audio when a lossy file is converted to WAV', async () => {
    const src = join(dir, 'lossy-to-wav.mp3')
    copyFileSync(lame, src)
    await convertAudio(src, join(dir, 'lossy-to-wav.wav'), 'wav', meta)
    expect(recorded()?.audio).toBeDefined()
  })
})

// Engine DJ keeps its cues as sample counts from the file's first sample, so a trim moves
// them by exactly the cut, and a resample changes the unit they are counted in. rekordbox's
// own timeline offsets (rekordboxTimeline.ts) are rekordbox's and stay out of it.
describe('what a conversion tells Engine DJ about its cues', () => {
  it('carries the cut from the start of a trimmed conversion', async () => {
    const src = join(dir, 'engine-trim.wav')
    pcm(src, 'pcm_s16le')
    await convertAudio(
      src,
      join(dir, 'engine-trim.aiff'),
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
    expect(recorded()?.engineShift).toEqual({ trimmedMs: 500, sampleCount: 66150 })
  })

  it('carries the new sample rate of a resampled conversion', async () => {
    const src = join(dir, 'engine-resample.wav')
    pcm(src, 'pcm_s16le')
    await convertAudio(
      src,
      join(dir, 'engine-resample.aiff'),
      'aiff',
      meta,
      undefined,
      undefined,
      undefined,
      {
        sampleRate: '48000',
      },
    )
    expect(recorded()?.engineShift).toEqual({
      trimmedMs: 0,
      sampleRateHz: 48000,
      sampleCount: 96000,
    })
  })

  // Engine keeps the track's length as a sample count. Worked out from the head cut alone it
  // stays long by whatever the end trim took, so the conversion hands over the count it
  // actually wrote.
  it('carries the exact length it wrote when the trim also cuts the end', async () => {
    const src = join(dir, 'engine-tail.wav')
    pcm(src, 'pcm_s16le')
    const out = join(dir, 'engine-tail.aiff')
    await convertAudio(
      src,
      out,
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
      { startSec: 0.25, endSec: 1.5 },
    )
    const written = Number(
      execFileSync(PROBE, [
        '-v',
        'error',
        '-show_entries',
        'stream=duration_ts',
        '-of',
        'default=nw=1:nk=1',
        out,
      ])
        .toString()
        .trim(),
    )
    expect(written).toBeGreaterThan(44100)
    expect(written).toBeLessThan(44100 * 1.5)
    expect(recorded()?.engineShift).toEqual({ trimmedMs: 250, sampleCount: written })
  })

  it('carries the length of a trim that only cuts the end', async () => {
    const src = join(dir, 'engine-tail-only.wav')
    pcm(src, 'pcm_s16le')
    await convertAudio(
      src,
      join(dir, 'engine-tail-only.aiff'),
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
      { endSec: 1.5 },
    )
    expect(recorded()?.engineShift).toEqual({ trimmedMs: 0, sampleCount: 66150 })
  })

  // A trim rewritten on the source's own path leaves Engine's row where it was: the size the
  // source had is what Engine still records, and what tells the write the cut is owed.
  it('carries the source’s size from before the rewrite when the trim lands in place', async () => {
    const src = join(dir, 'engine-inplace.wav')
    pcm(src, 'pcm_s16le')
    const size = readFileSync(src).length
    await convertAudio(
      src,
      src,
      'wav',
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
    expect(readFileSync(src).length).not.toBe(size)
    expect(recorded()).toMatchObject({ from: src, to: src, fromBytes: size })
  })

  it('carries no size when the conversion lands on another path', async () => {
    const src = join(dir, 'engine-moved.wav')
    pcm(src, 'pcm_s16le')
    await convertAudio(
      src,
      join(dir, 'engine-moved.aiff'),
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
    expect(recorded()?.fromBytes).toBeUndefined()
  })

  // The library's row is the replaced copy, not the file this cut was measured on: rekordbox
  // moves nothing there either.
  it('carries nothing when the conversion replaces another copy in the library', async () => {
    const src = join(dir, 'engine-replaces.wav')
    pcm(src, 'pcm_s16le')
    const old = join(dir, 'engine-replaces-old.mp3')
    copyFileSync(lame, old)
    await convertAudio(
      src,
      join(dir, 'engine-replaces.aiff'),
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
      undefined, // clearExtras
      undefined, // foreignRemoved
      old,
    )
    expect(recorded()?.from).toBe(old)
    expect(recorded()?.engineShift).toBeUndefined()
  })
})
