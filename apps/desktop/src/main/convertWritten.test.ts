import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import ffmpegStatic from 'ffmpeg-static'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

const digest = vi.hoisted(() => ({
  onStart: null as null | (() => void),
}))
vi.mock('./verifyPcm', async (importOriginal) => {
  const real = await importOriginal<typeof import('./verifyPcm')>()
  return {
    ...real,
    pcmDigest: async (...args: Parameters<typeof real.pcmDigest>) => {
      digest.onStart?.()
      return real.pcmDigest(...args)
    },
  }
})

import type { ConversionQuality, OutputFormat, TrackMetadata, TrimRange } from '../shared/types'
import { convertAudio } from './ffmpeg'
import { configureOriginalKeeper } from './originalKeeper'
import { pcmDigest } from './verifyPcm'

const FF = ffmpegStatic as unknown as string
const PROBE = ffprobeInstaller.path
const dir = mkdtempSync(join(tmpdir(), 'surco-written-'))

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

let n = 0
function source(ext: string, encode: string[] = []): string {
  const path = join(dir, `in${n++}${ext}`)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=color=pink:amplitude=0.3:duration=2:sample_rate=44100',
    '-ac',
    '2',
    ...encode,
    path,
  ])
  return path
}

const sha1 = (file: string) => createHash('sha1').update(readFileSync(file)).digest('hex')

function storedBits(file: string): number {
  const s = JSON.parse(
    execFileSync(PROBE, [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=codec_name,bits_per_raw_sample',
      '-of',
      'json',
      file,
    ]).toString(),
  ).streams[0]
  return Number(s.bits_per_raw_sample) || Number(/^pcm_[suf](\d+)/.exec(s.codec_name)?.[1]) || 0
}

function convert(
  input: string,
  output: string,
  format: OutputFormat,
  opts: {
    quality?: Partial<ConversionQuality>
    trim?: TrimRange
    isCancelled?: () => boolean
  } = {},
) {
  return convertAudio(
    input,
    output,
    format,
    meta,
    undefined,
    undefined,
    undefined,
    opts.quality,
    undefined,
    undefined,
    undefined,
    undefined,
    opts.trim,
    undefined,
    undefined,
    undefined,
    opts.isCancelled,
  )
}

afterEach(() => {
  digest.onStart = null
  configureOriginalKeeper(null)
})

describe('what convertAudio reports it wrote', () => {
  // The self-check compares the written audio against the source's. Rewritten in place,
  // the source is gone the moment the rename lands, so its fingerprint has to be taken
  // before: afterwards there is nothing left to compare against.
  it('an in-place AIFF tag update reports the source digest of the audio before the rewrite', async () => {
    const src = source('.aiff')
    const before = await pcmDigest(src)
    const shaBefore = sha1(src)

    const { written } = await convert(src, src, 'aiff')

    expect(sha1(src)).not.toBe(shaBefore)
    expect(written.samplesKept).toBe(true)
    expect(written.sourcePcm).toEqual(before)
  })

  // A lossy re-encode never keeps the samples, so there is nothing to digest: the check
  // compares durations instead, and the source's has to be measured by decoding it, the
  // same way the output's is.
  it('a reencode to MP3 carries no source digest', async () => {
    const src = source('.wav')
    const { written } = await convert(src, join(dir, 'reencoded.mp3'), 'mp3')

    expect(written.samplesKept).toBe(false)
    expect(written.sourcePcm).toBeUndefined()
    expect(written.plan).toMatchObject({ ext: '.mp3', codec: 'libmp3lame' })
    expect(written.plan.bitDepth).toBeUndefined()
    expect(written.sourceDurationSec).toBeCloseTo(2, 2)
    expect(written.trimmedSec).toBe(0)
  })

  // The digest decodes the whole source, which on a NAS takes long enough for the user to
  // press stop. The rename is what cannot be undone, so a cancel then must still find the
  // source as it was.
  it('a cancel during the digest leaves the source untouched', async () => {
    const src = source('.aiff')
    const shaBefore = sha1(src)
    let cancelled = false
    digest.onStart = () => {
      cancelled = true
    }

    await expect(convert(src, src, 'aiff', { isCancelled: () => cancelled })).rejects.toThrow(
      'conversionCancelled',
    )
    expect(sha1(src)).toBe(shaBefore)
  })

  // The digest only serves the check that comes after. A source it cannot fingerprint
  // (a timeout on a slow share) must not cost the user a conversion that went fine: the
  // check then says it could not compare, which is the honest answer.
  it('a digest that fails leaves the conversion standing without a source digest', async () => {
    const src = source('.aiff')
    digest.onStart = () => {
      throw new Error('timeout')
    }

    const { written } = await convert(src, src, 'aiff')

    expect(written.samplesKept).toBe(true)
    expect(written.sourcePcm).toBeUndefined()
  })

  // A trim shortens the output on purpose, so the duration check needs to know by how
  // much: both ends count, the tail as whatever the end bound cuts from the source.
  it('a trim reports the seconds it cut from both ends', async () => {
    const src = source('.wav')
    const { written } = await convert(src, join(dir, 'trimmed.wav'), 'wav', {
      trim: { startSec: 0.5, endSec: 1.75 },
    })

    expect(written.samplesKept).toBe(false)
    expect(written.sourceDurationSec).toBeCloseTo(2, 2)
    expect(written.trimmedSec).toBeCloseTo(0.5 + (written.sourceDurationSec as number) - 1.75, 6)
  })

  // When an in-place check fails there is no source to convert again from: what the user
  // is told depends on whether Originals still holds a copy.
  it('an in-place rewrite says whether Originals kept a copy', async () => {
    const kept = source('.aiff')
    configureOriginalKeeper(async (path) => ({
      id: 'x',
      name: 'in.aiff',
      originalPath: path,
      storedPath: join(dir, 'stored.aiff'),
      bytes: 1,
      trashedAt: 0,
      reason: 'replaced',
    }))
    expect((await convert(kept, kept, 'aiff')).written.originalKept).toBe(true)

    configureOriginalKeeper(null)
    const notKept = source('.aiff')
    expect((await convert(notKept, notKept, 'aiff')).written.originalKept).toBe(false)
  })

  it('a conversion to another path never claims Originals kept a copy', async () => {
    configureOriginalKeeper(async () => {
      throw new Error('must not be asked')
    })
    const src = source('.aiff')
    expect((await convert(src, join(dir, 'elsewhere.wav'), 'wav')).written.originalKept).toBe(false)
  })
})

// The check compares these bits strictly against what ffprobe reads back, so each one is
// pinned against the real file the bundled ffmpeg writes: a planned depth that differs
// from the stored one would flag every conversion of that kind as wrong.
describe('the planned bit depth is what the written file stores', () => {
  const EXT: Record<OutputFormat, string> = {
    flac: '.flac',
    alac: '.m4a',
    wav: '.wav',
    aiff: '.aiff',
    mp3: '.mp3',
  }
  const S16 = ['-c:a', 'pcm_s16le']
  const S24 = ['-c:a', 'pcm_s24le']
  const S32 = ['-c:a', 'pcm_s32le']
  const F32 = ['-c:a', 'pcm_f32le']
  const cases: [string, string, string[], OutputFormat, Partial<ConversionQuality>][] = [
    ['16-bit WAV to FLAC', '.wav', S16, 'flac', {}],
    ['24-bit WAV to FLAC', '.wav', S24, 'flac', {}],
    ['32-bit WAV to FLAC', '.wav', S32, 'flac', {}],
    ['float WAV to FLAC', '.wav', F32, 'flac', {}],
    ['16-bit WAV to FLAC pinned to 24', '.wav', S16, 'flac', { bitDepth: '24' }],
    ['24-bit WAV to FLAC pinned to 16', '.wav', S24, 'flac', { bitDepth: '16' }],
    ['16-bit WAV to ALAC', '.wav', S16, 'alac', {}],
    ['24-bit WAV to ALAC', '.wav', S24, 'alac', {}],
    ['float WAV to ALAC', '.wav', F32, 'alac', {}],
    ['16-bit WAV to ALAC pinned to 24', '.wav', S16, 'alac', { bitDepth: '24' }],
    ['16-bit FLAC to WAV', '.flac', ['-sample_fmt', 's16'], 'wav', {}],
    ['24-bit FLAC to AIFF', '.flac', ['-sample_fmt', 's32'], 'aiff', {}],
    ['32-bit WAV to AIFF', '.wav', S32, 'aiff', {}],
    ['float WAV to AIFF', '.wav', F32, 'aiff', {}],
    ['24-bit WAV to WAV pinned to 16', '.wav', S24, 'wav', { bitDepth: '16' }],
    [
      '24-bit AIFF copied with 24 pinned',
      '.aiff',
      ['-c:a', 'pcm_s24be'],
      'aiff',
      { bitDepth: '24' },
    ],
    [
      '24-bit FLAC copied with 24 pinned',
      '.flac',
      ['-sample_fmt', 's32'],
      'flac',
      { bitDepth: '24' },
    ],
    [
      '16-bit ALAC copied with 16 pinned',
      '.m4a',
      ['-c:a', 'alac', '-sample_fmt', 's16p'],
      'alac',
      { bitDepth: '16' },
    ],
  ]

  it.each(cases)('%s', async (_, ext, encode, format, quality) => {
    const src = source(ext, encode)
    const out = join(dir, `depth${n++}${EXT[format]}`)
    const { written } = await convert(src, out, format, { quality })
    expect(written.plan.bitDepth).toBe(storedBits(out))
  })

  // An unpinned same-format copy plans without probing the source, and the digest already
  // proves the copy identical, so it claims no depth rather than spend a probe on one.
  it('an unpinned same-format copy claims no depth', async () => {
    const src = source('.aiff')
    const { written } = await convert(src, join(dir, 'copied.aiff'), 'aiff')
    expect(written.plan.codec).toBe('copy')
    expect(written.plan.bitDepth).toBeUndefined()
  })
})
