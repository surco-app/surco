import { execFileSync } from 'node:child_process'
import { mkdtempSync, statSync, truncateSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { emptyMetadata } from '../shared/metadata'
import type { TrackMetadata } from '../shared/types'
import { writeTags } from './tags'
import { checkFile, type FileExpect, type FileReaders, fileReaders } from './verifyFile'
import { pcmDigest } from './verifyPcm'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-verifyfile-'))
const at = (name: string) => join(dir, name)
const kick = 'aevalsrc=0.95*sin(2*PI*55*t)*exp(-4*mod(t\\,0.5)):s=44100:d=4'
const hat = 'aevalsrc=0.5*sin(2*PI*3000*t)*exp(-9*mod(t\\,0.25)):s=44100:d=4'

function ff(...args: string[]): void {
  execFileSync(FF, ['-y', '-v', 'error', ...args])
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
    const check = await checkFile(await expectFor(at('source.wav')), readers)
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
})
