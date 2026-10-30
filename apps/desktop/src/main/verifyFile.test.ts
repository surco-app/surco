import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  statSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { errorKeyOf } from '../shared/errorKeys'
import { emptyMetadata } from '../shared/metadata'
import type { OutputFormat, TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'
import { leadingId3v2Size } from './id3Header'
import { writeTags } from './tags'
import {
  checkFile,
  type FileExpect,
  type FileReaders,
  fileReaders,
  type ReadOpts,
} from './verifyFile'
import { pcmDigest, pcmTimeoutMs } from './verifyPcm'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-verifyfile-'))
const at = (name: string) => join(dir, name)
const kick = 'aevalsrc=0.95*sin(2*PI*55*t)*exp(-4*mod(t\\,0.5)):s=44100:d=4'
const hat = 'aevalsrc=0.5*sin(2*PI*3000*t)*exp(-9*mod(t\\,0.25)):s=44100:d=4'

function ff(...args: string[]): void {
  execFileSync(FF, ['-y', '-v', 'error', ...args])
}

function malformedWav(path: string): string {
  const u32 = (v: number) => Buffer.from(Uint32Array.of(v).buffer)
  const u16 = (v: number) => Buffer.from(Uint16Array.of(v).buffer)
  const data = readFileSync(at('source.wav')).subarray(44)
  const fmt = Buffer.concat([
    Buffer.from('fmt '),
    u32(16),
    u16(1),
    u16(2),
    u32(44100),
    u32(44100 * 4),
    u16(4),
    u16(16),
  ])
  const body = Buffer.concat([
    Buffer.from('WAVE'),
    fmt,
    Buffer.from('LIST'),
    u32(0),
    Buffer.from('data'),
    u32(data.length),
    data,
  ])
  writeFileSync(path, Buffer.concat([Buffer.from('RIFF'), u32(body.length), body]))
  return path
}

const meta = (over: Partial<TrackMetadata> = {}): TrackMetadata => ({ ...emptyMetadata(), ...over })

async function expectFor(path: string, over: Partial<FileExpect> = {}): Promise<FileExpect> {
  return {
    path,
    ext: '.wav',
    codec: 'pcm_s16le',
    samplesKept: true,
    sourcePcm: await pcmDigest(at('source.wav')),
    sourceDurationSec: 4,
    trimmedSec: 0,
    tags: {},
    cover: 'untouched',
    ...over,
  }
}

beforeAll(() => {
  ff('-f', 'lavfi', '-i', kick, '-ac', '2', '-c:a', 'pcm_s16le', at('source.wav'))
  ff('-f', 'lavfi', '-i', hat, '-ac', '2', '-c:a', 'pcm_s16le', at('other.wav'))
  ff('-i', at('source.wav'), '-c:a', 'pcm_s16be', at('source.aiff'))
  ff('-f', 'lavfi', '-i', 'color=c=red:s=32x32:d=1', '-frames:v', '1', at('cover.jpg'))
})

describe('checkFile', () => {
  it('a WAV whose audio equals the source is ok with fileIdentical', async () => {
    const check = await checkFile(await expectFor(at('source.wav')), fileReaders)
    expect(check).toEqual({
      place: 'file',
      state: 'ok',
      detail: { key: 'fileIdentical', params: { format: 'WAV' } },
    })
  })

  it('a WAV whose audio differs is a mismatch with filePcmDiffers', async () => {
    const check = await checkFile(await expectFor(at('other.wav')), fileReaders)
    expect(check.state).toBe('mismatch')
    expect(check.detail.key).toBe('filePcmDiffers')
  })

  it('an AIFF left where a WAV was asked is fileWrongFormat with expected WAV, actual AIFF', async () => {
    const check = await checkFile(await expectFor(at('source.aiff')), fileReaders)
    expect(check.state).toBe('mismatch')
    expect(check.detail).toEqual({
      key: 'fileWrongFormat',
      params: { expected: 'WAV', actual: 'AIFF' },
    })
  })

  it('a file cut to a quarter is fileTruncated', async () => {
    const cut = at('cut.flac')
    ff('-i', at('source.wav'), '-c:a', 'flac', cut)
    truncateSync(cut, Math.floor(statSync(cut).size / 4))
    const check = await checkFile(
      await expectFor(cut, { ext: '.flac', codec: 'flac', samplesKept: false }),
      fileReaders,
    )
    expect(check.state).toBe('mismatch')
    expect(check.detail.key).toBe('fileTruncated')
  })

  // The digest alone says the samples differ; the decode it then needs says why.
  it('a file whose samples were kept, cut to a quarter, is fileTruncated', async () => {
    const cut = at('cut-kept.flac')
    ff('-i', at('source.wav'), '-c:a', 'flac', cut)
    truncateSync(cut, Math.floor(statSync(cut).size / 4))
    const check = await checkFile(
      await expectFor(cut, { ext: '.flac', codec: 'flac' }),
      fileReaders,
    )
    expect(check.detail.key).toBe('fileTruncated')
  })

  it('a missing file is fileMissing', async () => {
    const check = await checkFile(await expectFor(at('nothing.wav')), fileReaders)
    expect(check).toMatchObject({ state: 'mismatch', detail: { key: 'fileMissing' } })
  })

  it('the path is found when written NFD and asked NFC', async () => {
    ff('-i', at('source.wav'), '-c:a', 'pcm_s16le', at('Café.wav'))
    const check = await checkFile(await expectFor(at('Café.wav')), fileReaders)
    expect(check.state).toBe('ok')
  })

  it('a title that did not reach the file is fileTagDiffers with field title', async () => {
    ff('-i', at('source.wav'), '-c:a', 'pcm_s16le', at('titled.wav'))
    writeTags(at('titled.wav'), meta({ title: 'Old', artist: 'Same' }))
    const check = await checkFile(
      await expectFor(at('titled.wav'), { tags: { title: 'New', artist: 'Same' } }),
      fileReaders,
    )
    expect(check.state).toBe('mismatch')
    expect(check.detail).toEqual({ key: 'fileTagDiffers', params: { field: 'title' } })
  })

  it.each([
    ['wav', 'pcm_s16le'],
    ['aiff', 'pcm_s16be'],
    ['flac', 'flac'],
    ['mp3', 'libmp3lame'],
    ['m4a', 'aac'],
  ])('tags that writeTags put in a %s are read back as equal', async (ext, codec) => {
    const file = at(`tagged.${ext}`)
    ff('-i', at('source.wav'), '-c:a', codec, file)
    const tags = meta({
      title: 'Tít',
      artist: 'Art',
      album: 'Alb',
      albumArtist: 'AA',
      year: '2020',
      genre: 'Gen',
      grouping: 'Grp',
      comment: 'Com',
      trackNumber: '3',
      bpm: '128',
      key: '8A',
    })
    writeTags(file, tags)
    const check = await checkFile(
      await expectFor(file, {
        ext: `.${ext}` as FileExpect['ext'],
        codec: 'copy',
        samplesKept: false,
        tags,
      }),
      fileReaders,
    )
    expect(check.state).toBe('ok')
  })

  it('a cover written but absent is fileNoCover', async () => {
    const check = await checkFile(
      await expectFor(at('source.wav'), { cover: 'written' }),
      fileReaders,
    )
    expect(check.detail.key).toBe('fileNoCover')
  })

  it('a cover removed but still present is fileCoverKept', async () => {
    ff('-i', at('source.wav'), '-c:a', 'pcm_s16le', at('covered.wav'))
    writeTags(at('covered.wav'), meta(), at('cover.jpg'))
    const check = await checkFile(
      await expectFor(at('covered.wav'), { cover: 'removed' }),
      fileReaders,
    )
    expect(check.detail.key).toBe('fileCoverKept')
  })

  it('a reencode within 50 ms of the source minus the trim is ok with fileReencoded', async () => {
    ff('-ss', '0.5', '-i', at('source.wav'), '-c:a', 'flac', at('trimmed.flac'))
    const check = await checkFile(
      await expectFor(at('trimmed.flac'), {
        ext: '.flac',
        codec: 'flac',
        samplesKept: false,
        sourcePcm: undefined,
        trimmedSec: 0.5,
      }),
      fileReaders,
    )
    expect(check).toEqual({
      place: 'file',
      state: 'ok',
      detail: { key: 'fileReencoded', params: { format: 'FLAC', rate: 44100, bits: 16 } },
    })
  })

  it('a reencode that lost a second is fileTruncated', async () => {
    ff('-t', '3', '-i', at('source.wav'), '-c:a', 'flac', at('short.flac'))
    const check = await checkFile(
      await expectFor(at('short.flac'), { ext: '.flac', codec: 'flac', samplesKept: false }),
      fileReaders,
    )
    expect(check.detail.key).toBe('fileTruncated')
  })

  it('a timed out read is unreadable, never ok', async () => {
    const readers: FileReaders = {
      ...fileReaders,
      assertDecodable: () =>
        Promise.reject(Object.assign(new Error('timed out'), { killed: true })),
    }
    const check = await checkFile(
      await expectFor(at('source.wav'), { samplesKept: false }),
      readers,
    )
    expect(check.state).toBe('unreadable')
  })

  it('a digest that cannot be read is unreadable, never ok', async () => {
    const readers: FileReaders = {
      ...fileReaders,
      pcmDigest: () => Promise.reject(new Error('EIO')),
    }
    const check = await checkFile(await expectFor(at('source.wav')), readers)
    expect(check.state).toBe('unreadable')
  })

  it('samples that had to be kept but have no source digest are unreadable, never ok', async () => {
    const check = await checkFile(
      await expectFor(at('source.wav'), { sourcePcm: undefined }),
      fileReaders,
    )
    expect(check).toMatchObject({ state: 'unreadable', detail: { key: 'fileUnreadable' } })
  })

  it('a reencode with no source duration is unreadable, never ok', async () => {
    const check = await checkFile(
      await expectFor(at('source.wav'), { samplesKept: false, sourceDurationSec: undefined }),
      fileReaders,
    )
    expect(check.state).toBe('unreadable')
  })

  it('a PCM file 0.1 s short of the source is fileTruncated', async () => {
    ff('-t', '3.9', '-i', at('source.wav'), '-c:a', 'pcm_s16le', at('short.wav'))
    const check = await checkFile(
      await expectFor(at('short.wav'), { samplesKept: false, sourcePcm: undefined }),
      fileReaders,
    )
    expect(check.detail.key).toBe('fileTruncated')
  })

  it('a 22.05 kHz FLAC 0.4 s short of the source is fileTruncated', async () => {
    ff('-t', '3.6', '-i', at('source.wav'), '-ar', '22050', '-c:a', 'flac', at('short22.flac'))
    const check = await checkFile(
      await expectFor(at('short22.flac'), {
        ext: '.flac',
        codec: 'flac',
        samplesKept: false,
        sourcePcm: undefined,
      }),
      fileReaders,
    )
    expect(check.detail.key).toBe('fileTruncated')
  })

  const WRITTEN: Partial<TrackMetadata> = {
    title: 'Tít',
    artist: 'Art',
    album: 'Alb',
    albumArtist: 'AA',
    year: '2020',
    genre: 'Gen',
    grouping: 'Grp',
    comment: 'Com',
    trackNumber: '3',
    bpm: '128',
    key: '8A',
  }
  const OTHER: Partial<TrackMetadata> = {
    title: 'Otro',
    artist: 'Otra',
    album: 'Otro',
    albumArtist: 'Otro',
    year: '1999',
    genre: 'Otro',
    grouping: 'Otro',
    comment: 'Otro',
    trackNumber: '9',
    bpm: '90',
    key: '1B',
  }
  const FORMATS = [
    ['wav', 'pcm_s16le'],
    ['aiff', 'pcm_s16be'],
    ['flac', 'flac'],
    ['mp3', 'libmp3lame'],
    ['m4a', 'aac'],
  ]
  const cases = FORMATS.flatMap(([ext, codec]) =>
    Object.keys(WRITTEN).map((field) => [ext, codec, field]),
  )

  it.each(cases)(
    'a %s whose %s... field %s was not written is fileTagDiffers',
    async (ext, codec, field) => {
      const file = at(`field-${field}.${ext}`)
      ff('-i', at('source.wav'), '-c:a', codec, file)
      writeTags(file, meta({ ...WRITTEN, [field]: OTHER[field as keyof TrackMetadata] }))
      const check = await checkFile(
        await expectFor(file, {
          ext: `.${ext}` as FileExpect['ext'],
          codec: 'copy',
          samplesKept: false,
          tags: WRITTEN,
        }),
        fileReaders,
      )
      expect(check.detail).toEqual({ key: 'fileTagDiffers', params: { field } })
    },
  )

  it.each(FORMATS)(
    'a %s whose title was meant to be cleared but is still there is fileTagDiffers',
    async (ext, codec) => {
      const file = at(`cleared.${ext}`)
      ff('-i', at('source.wav'), '-c:a', codec, file)
      writeTags(file, meta({ title: 'Stays', trackNumber: '4', bpm: '120' }))
      const fields: (keyof TrackMetadata)[] = ['title', 'trackNumber', 'bpm']
      for (const field of fields) {
        const check = await checkFile(
          await expectFor(file, {
            ext: `.${ext}` as FileExpect['ext'],
            codec: 'copy',
            samplesKept: false,
            tags: { [field]: '' },
          }),
          fileReaders,
        )
        expect(check.detail, `${ext} ${field}`).toEqual({
          key: 'fileTagDiffers',
          params: { field },
        })
      }
    },
  )

  it('a field meant to be cleared and absent is ok', async () => {
    const file = at('bare.wav')
    ff('-i', at('source.wav'), '-c:a', 'pcm_s16le', file)
    writeTags(file, meta())
    const check = await checkFile(
      await expectFor(file, { samplesKept: false, tags: { title: '', year: '' } }),
      fileReaders,
    )
    expect(check.state).toBe('ok')
  })

  it.each(['id3 TYER=', 'id3 TYER=20'])(
    'a stored year of "%s" never matches an expected 2020',
    async (line) => {
      const readers: FileReaders = { ...fileReaders, snapshotTags: () => [line] }
      const check = await checkFile(
        await expectFor(at('source.wav'), { tags: { year: '2020' } }),
        readers,
      )
      expect(check.detail).toEqual({ key: 'fileTagDiffers', params: { field: 'year' } })
    },
  )

  it('a bit depth that cannot be read is unreadable, never skipped', async () => {
    const readers: FileReaders = {
      ...fileReaders,
      probe: async () => ({
        ...(await fileReaders.probe(at('source.wav'))),
        codecName: 'mp3',
        bitsPerRawSample: 0,
      }),
    }
    const check = await checkFile(
      await expectFor(at('source.wav'), { codec: 'mp3', bitDepth: 16 }),
      readers,
    )
    expect(check.state).toBe('unreadable')
  })

  it('an empty codec name is unreadable, not a format mismatch', async () => {
    const readers: FileReaders = {
      ...fileReaders,
      probe: async () => ({ ...(await fileReaders.probe(at('source.wav'))), codecName: '' }),
    }
    const check = await checkFile(await expectFor(at('source.wav')), readers)
    expect(check.state).toBe('unreadable')
  })

  it('a probe without a sample rate is unreadable, never an unchecked truncation', async () => {
    ff('-t', '1', '-i', at('source.wav'), '-c:a', 'flac', at('norate.flac'))
    const readers: FileReaders = {
      ...fileReaders,
      probe: async () => ({ ...(await fileReaders.probe(at('norate.flac'))), sampleRate: '' }),
    }
    const check = await checkFile(
      await expectFor(at('norate.flac'), { ext: '.flac', codec: 'flac', samplesKept: false }),
      readers,
    )
    expect(check.state).toBe('unreadable')
  })

  it.each([
    ['sourceDurationSec', { sourceDurationSec: Number.NaN }],
    ['trimmedSec', { trimmedSec: Number.NaN }],
  ])('a non-finite %s is unreadable, never ok', async (_name, over) => {
    const check = await checkFile(
      await expectFor(at('source.wav'), { samplesKept: false, ...over }),
      fileReaders,
    )
    expect(check.state).toBe('unreadable')
  })

  it.each(['source', 'output'])('an empty %s digest is unreadable, never equal', async (side) => {
    const empty = { md5: '', sampleRate: 44100, channels: 2 }
    const readers: FileReaders = {
      ...fileReaders,
      pcmDigest: async (path, opts) =>
        side === 'output' ? empty : fileReaders.pcmDigest(path, opts),
    }
    const check = await checkFile(
      await expectFor(at('source.wav'), side === 'source' ? { sourcePcm: empty } : {}),
      readers,
    )
    expect(check.state).toBe('unreadable')
  })
})

describe('checkFile — cost and cancel', () => {
  const long = at('long.flac')
  beforeAll(() => {
    ff(
      '-f',
      'lavfi',
      '-i',
      'anoisesrc=color=pink:amplitude=0.3:duration=600:sample_rate=44100',
      '-ac',
      '2',
      '-c:a',
      'flac',
      long,
    )
  })

  const counted = () => {
    const calls = { assertDecodable: 0, deliveredDurationSec: 0, pcmDigest: 0 }
    const opts: ReadOpts[] = []
    const readers: FileReaders = {
      ...fileReaders,
      assertDecodable: (path, o) => {
        calls.assertDecodable++
        opts.push(o)
        return fileReaders.assertDecodable(path, o)
      },
      deliveredDurationSec: (path, o) => {
        calls.deliveredDurationSec++
        return fileReaders.deliveredDurationSec(path, o)
      },
      pcmDigest: (path, o) => {
        calls.pcmDigest++
        return fileReaders.pcmDigest(path, o)
      },
    }
    return { calls, opts, readers }
  }

  const reencoded = (path: string, over: Partial<FileExpect> = {}) =>
    expectFor(path, {
      ext: '.flac',
      codec: 'flac',
      samplesKept: false,
      sourcePcm: undefined,
      sourceDurationSec: 600,
      ...over,
    })

  it('a cancel during the decode rejects as cancelled, never as unreadable', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 50)
    const failure = await checkFile(await reencoded(long), fileReaders, {
      signal: controller.signal,
    }).catch((e: unknown) => e)
    expect(errorKeyOf((failure as Error).message)).toBe('conversionCancelled')
  })

  it('a re-encoded file is decoded once, by a pass bounded by its size', async () => {
    const { calls, opts, readers } = counted()
    const check = await checkFile(await reencoded(long), readers)
    expect(check.state).toBe('ok')
    expect(calls).toEqual({ assertDecodable: 1, deliveredDurationSec: 0, pcmDigest: 0 })
    const probe = await fileReaders.probe(long)
    expect(opts[0].timeoutMs).toBe(pcmTimeoutMs(statSync(long).size, probe.headerSeconds))
  })

  it('a file whose samples were kept is decoded once, for its digest', async () => {
    const { calls, readers } = counted()
    const check = await checkFile(await expectFor(at('source.wav')), readers)
    expect(check.state).toBe('ok')
    expect(calls).toEqual({ assertDecodable: 0, deliveredDurationSec: 0, pcmDigest: 1 })
  })

  const kept = async (path: string) => {
    const { size, mtimeMs, ino } = statSync(path)
    return { size, mtimeMs, ino, durationSec: 4, pcm: await pcmDigest(path) }
  }

  it('the kept samples convertAudio digested in its proof are not digested again', async () => {
    const copy = at('proven-kept.wav')
    copyFileSync(at('source.wav'), copy)
    const { calls, readers } = counted()
    const check = await checkFile(await expectFor(copy, { proven: await kept(copy) }), readers)
    expect(check.state).toBe('ok')
    expect(calls).toEqual({ assertDecodable: 0, deliveredDurationSec: 0, pcmDigest: 0 })
  })

  it('a proof whose digest differs from the source is filePcmDiffers', async () => {
    const copy = at('proven-other.wav')
    copyFileSync(at('other.wav'), copy)
    const check = await checkFile(await expectFor(copy, { proven: await kept(copy) }), fileReaders)
    expect(check.detail.key).toBe('filePcmDiffers')
  })

  it('kept samples written again after the proof are digested again', async () => {
    const copy = at('touched-kept.wav')
    copyFileSync(at('source.wav'), copy)
    const proven = await kept(copy)
    utimesSync(copy, new Date(), new Date(Date.now() + 5000))
    const { calls, readers } = counted()
    const check = await checkFile(
      await expectFor(copy, { proven: { ...proven, pcm: { ...proven.pcm, md5: '0'.repeat(32) } } }),
      readers,
    )
    expect(check.state).toBe('ok')
    expect(calls.pcmDigest).toBe(1)
  })

  it('the bytes convertAudio proved decodable are not decoded again', async () => {
    const copy = at('proven.flac')
    copyFileSync(long, copy)
    const { size, mtimeMs, ino } = statSync(copy)
    const { calls, readers } = counted()
    const check = await checkFile(
      await reencoded(copy, { proven: { size, mtimeMs, ino, durationSec: 600 } }),
      readers,
    )
    expect(check.state).toBe('ok')
    expect(calls).toEqual({ assertDecodable: 0, deliveredDurationSec: 0, pcmDigest: 0 })
  })

  it('a file written again after the proof is decoded again', async () => {
    const copy = at('touched.flac')
    copyFileSync(long, copy)
    const { size, mtimeMs, ino } = statSync(copy)
    utimesSync(copy, new Date(), new Date(Date.now() + 5000))
    const { calls, readers } = counted()
    const check = await checkFile(
      await reencoded(copy, { proven: { size, mtimeMs, ino, durationSec: 1 } }),
      readers,
    )
    expect(check.state).toBe('ok')
    expect(calls.assertDecodable).toBe(1)
  })
})

describe('checkFile — what convertAudio wrote reads back as written', () => {
  let n = 0
  const converted = async (
    format: OutputFormat,
    tags: Partial<TrackMetadata>,
    source = at('source.wav'),
  ) => {
    const out = at(`conv-${n++}.${format === 'alac' ? 'm4a' : format}`)
    const { written } = await convertAudio(source, out, format, meta(tags))
    return checkFile(
      {
        path: out,
        ext: written.plan.ext,
        codec: written.plan.codec,
        sampleRateHz: written.plan.sampleRateHz,
        bitDepth: written.plan.bitDepth,
        samplesKept: written.samplesKept,
        sourcePcm: written.sourcePcm,
        sourceDurationSec: written.sourceDurationSec,
        trimmedSec: written.trimmedSec,
        tags,
        cover: 'untouched',
        ...(written.proven ? { proven: written.proven } : {}),
      },
      fileReaders,
    )
  }

  // ID3v2.3 has no separator of its own, so TagLib reads a '/' (and a TCON ';') as one:
  // "AC/DC" comes back as the two values AC and DC, which is still what was written. The
  // comment sends the file through the TagLib pass, the one that writes TIT1.
  it.each(
    (['mp3', 'aiff'] as OutputFormat[]).flatMap((format) =>
      (
        [
          ['artist', 'AC/DC'],
          ['albumArtist', 'X/Y'],
          ['grouping', 'g/h'],
          ['genre', 'Drum & Bass / Jungle'],
          ['genre', 'House; Deep House'],
          ['genre', 'House;Deep House'],
        ] as const
      ).map(([field, value]) => [format, field, value] as const),
    ),
  )(
    'a %s whose %s "%s" TagLib reads split is ok',
    async (format, field, value) => {
      const check = await converted(format, { title: 'T', comment: 'C', [field]: value })
      expect(check.state, JSON.stringify(check.detail)).toBe('ok')
    },
    30_000,
  )

  it('values split in another order are still fileTagDiffers', async () => {
    const readers: FileReaders = {
      ...fileReaders,
      snapshotTags: () => ['id3 TCON=Deep House|House'],
    }
    const check = await checkFile(
      await expectFor(at('source.wav'), { tags: { genre: 'House; Deep House' } }),
      readers,
    )
    expect(check.detail).toEqual({ key: 'fileTagDiffers', params: { field: 'genre' } })
  })

  // An M4A keeps the key and the label side by side as freeform atoms: only the one named
  // initialkey is the key.
  it('an M4A with a label and no key is ok', async () => {
    const check = await converted('alac', { title: 'T', publisher: 'Lbl', key: '' })
    expect(check.state, JSON.stringify(check.detail)).toBe('ok')
  }, 30_000)

  it('an M4A whose label holds the key that was asked is still fileTagDiffers', async () => {
    const file = at('key-in-label.m4a')
    ff('-i', at('source.wav'), '-c:a', 'alac', file)
    writeTags(file, meta({ key: '1B', publisher: '8A' }))
    const check = await checkFile(
      await expectFor(file, {
        ext: '.m4a',
        codec: 'copy',
        samplesKept: false,
        tags: { key: '8A' },
      }),
      fileReaders,
    )
    expect(check.detail).toEqual({ key: 'fileTagDiffers', params: { field: 'key' } })
  })

  // A vinyl side position is text: "A2" is not a number, and NaN never equals NaN.
  it.each(['mp3', 'aiff', 'flac', 'wav', 'alac'] as OutputFormat[])(
    'a %s whose track is the vinyl position A2 is ok',
    async (format) => {
      const check = await converted(format, { title: 'T', trackNumber: 'A2' })
      expect(check.state, JSON.stringify(check.detail)).toBe('ok')
    },
    30_000,
  )

  it.each(['mp3', 'flac'])('a %s holding A3 where A2 was asked is fileTagDiffers', async (ext) => {
    const file = at(`side.${ext}`)
    ff('-i', at('source.wav'), file)
    writeTags(file, meta({ trackNumber: 'A3' }))
    const check = await checkFile(
      await expectFor(file, {
        ext: `.${ext}` as FileExpect['ext'],
        codec: 'copy',
        samplesKept: false,
        tags: { trackNumber: 'A2' },
      }),
      fileReaders,
    )
    expect(check.detail).toEqual({ key: 'fileTagDiffers', params: { field: 'trackNumber' } })
  })

  // The copy drops the bytes ahead of the first frame (absorbMp3HeadJunk) and the decoder
  // reads them as a frame of their own: the source decoded raw starts 1105 samples early.
  it('an MP3 with junk ahead of its first frame, copied to MP3, is ok', async () => {
    const clean = at('clean.mp3')
    ff('-i', at('source.wav'), '-id3v2_version', '3', '-metadata', 'title=O', clean)
    const bytes = readFileSync(clean)
    const head = leadingId3v2Size(bytes)
    const junk = at('junk.mp3')
    writeFileSync(
      junk,
      Buffer.concat([bytes.subarray(0, head), Buffer.alloc(4000), bytes.subarray(head)]),
    )
    const check = await converted('mp3', { title: 'T' }, junk)
    expect(check.state, JSON.stringify(check.detail)).toBe('ok')
  }, 30_000)

  // ffmpeg refuses a LIST chunk shorter than its own header; every other read repairs a
  // copy and retries, so the conversion goes through and the check has to as well.
  it('a WAV with a too-short LIST chunk, converted to AIFF, is ok', async () => {
    const check = await converted('aiff', { title: 'T' }, malformedWav(at('short-list.wav')))
    expect(check.state, JSON.stringify(check.detail)).toBe('ok')
  }, 30_000)

  // The decode that proves the temp whole digests it too: the check that finds the same
  // bytes then compares that digest instead of decoding the file a second time.
  it.each([
    ['flac', 'pcm_s16le'],
    ['aiff', 'pcm_s24le'],
  ] as const)(
    'a %s whose samples were kept carries the digest of its proof',
    async (format, codec) => {
      const source = at(`proof-${codec}.wav`)
      ff('-i', at('source.wav'), '-c:a', codec, source)
      const out = at(`proof-${codec}.${format}`)
      const { written } = await convertAudio(source, out, format, meta({ title: 'T' }))
      expect(written.samplesKept).toBe(true)
      expect(written.proven?.pcm).toEqual(await pcmDigest(out))
    },
    30_000,
  )
})
