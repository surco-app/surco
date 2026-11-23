import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  ByteVector,
  Id3v2FrameClassType,
  type Id3v2Tag,
  type Id3v2TextInformationFrame,
  type Id3v2UserTextInformationFrame,
  type Mpeg4AppleTag,
  StringType,
  File as TagFile,
  TagTypes,
  type XiphComment,
} from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { emptyMetadata } from '../shared/metadata'
import type { OutputFormat } from '../shared/types'
import { convertAudio, readMeta } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-m4a-sources-'))
let n = 0

function m4a(codec: 'aac' | 'alac'): string {
  const path = join(dir, `src${n++}.m4a`)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=d=2',
    '-c:a',
    codec,
    path,
  ])
  return path
}

function tagNames(path: string): string[] {
  return String(execFileSync(FF, ['-loglevel', 'error', '-i', path, '-f', 'ffmetadata', '-']))
    .split('\n')
    .filter((line) => line.includes('='))
    .map((line) => line.slice(0, line.indexOf('=')).toLowerCase())
}

async function convert(
  src: string,
  target: OutputFormat,
  options: { clearExtras?: boolean; foreignRemoved?: string[] } = {},
): Promise<string> {
  const out = join(dir, `out${n++}.${target === 'alac' ? 'm4a' : target}`)
  const tags = options.clearExtras ? emptyMetadata() : (await readMeta(src)).tags
  await convertAudio(
    src,
    out,
    target,
    { ...tags, title: 'New title' },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    options.clearExtras,
    options.foreignRemoved,
  )
  return out
}

// ffmpeg reads an MP4's file-type box as three tags and wrote them into every MP3, AIFF and
// FLAC made from an M4A: rows the DJ never wrote, naming a container the file is not.
describe.each(['aac', 'alac'] as const)('an %s M4A', (codec) => {
  it.each(['mp3', 'aiff', 'wav', 'flac'] as OutputFormat[])(
    'leaves its container brands out of %s',
    async (target) => {
      const names = await convert(m4a(codec), target).then(tagNames)
      expect(
        names.filter((name) =>
          ['major_brand', 'minor_version', 'compatible_brands'].includes(name),
        ),
      ).toEqual([])
    },
  )
})

const box = (type: string) => ByteVector.fromString(type, StringType.Latin1)

const FREEFORM: [string, string, string[]][] = [
  ['com.apple.iTunes', 'MusicBrainz Artist Id', ['id-1', 'id-2']],
  ['com.apple.iTunes', 'SINGLE', ['one']],
  ['com.example.tagger', 'session', ['take 3']],
]

// The atoms, the ID3 frame and the Vorbis field each standard atom belongs in.
const ATOMS: [string, string, string][] = [
  ['soar', 'TSOP', 'ARTISTSORT'],
  ['soal', 'TSOA', 'ALBUMSORT'],
  ['sonm', 'TSOT', 'TITLESORT'],
  ['soaa', 'TSO2', 'ALBUMARTISTSORT'],
  ['soco', 'TSOC', 'COMPOSERSORT'],
  ['©wrk', 'TXXX:WORK', 'WORK'],
  ['©mvn', 'TXXX:MOVEMENTNAME', 'MOVEMENTNAME'],
  ['catg', 'TXXX:category', 'CATEGORY'],
]

function tagged(codec: 'aac' | 'alac'): string {
  const path = m4a(codec)
  const f = TagFile.createFromPath(path)
  const apple = f.tag as Mpeg4AppleTag
  for (const [mean, name, values] of FREEFORM) apple.setItunesStrings(mean, name, ...values)
  for (const [atom] of ATOMS) apple.setQuickTimeString(box(atom), `${atom} value`)
  f.save()
  f.dispose()
  return path
}

function id3Tags(path: string): Record<string, string[]> {
  const f = TagFile.createFromPath(path)
  try {
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
    const out: Record<string, string[]> = {}
    for (const frame of id3?.frames ?? []) {
      const id = frame.frameId.toString()
      const key =
        frame.frameClassType === Id3v2FrameClassType.UserTextInformationFrame
          ? `TXXX:${(frame as Id3v2UserTextInformationFrame).description}`
          : id
      if (id.startsWith('T'))
        out[key] = [...(out[key] ?? []), ...(frame as Id3v2TextInformationFrame).text]
    }
    return out
  } finally {
    f.dispose()
  }
}

function vorbis(path: string): XiphComment {
  const f = TagFile.createFromPath(path)
  const xiph = f.getTag(TagTypes.Xiph, false) as XiphComment
  f.dispose()
  return xiph
}

// Measured 23/11/2026 with the bundled ffmpeg: an M4A converted to MP3, AIFF or FLAC kept
// one value of a freeform atom holding several (the last), wrote the sort names as TXXX
// "sort_artist" and SORT_ARTIST nothing sorts by, and dropped the work and movement; to
// WAV it lost every one of them. They are the DJ's tags whatever format they cross into.
describe.each(['aac', 'alac'] as const)('an %s M4A tagged elsewhere', (codec) => {
  it.each(['mp3', 'aiff', 'wav'] as OutputFormat[])(
    'keeps its atoms converted to %s',
    async (target) => {
      const tags = id3Tags(await convert(tagged(codec), target))
      for (const [, name, values] of FREEFORM) expect(tags[`TXXX:${name}`], name).toEqual(values)
      for (const [atom, frame] of ATOMS) expect(tags[frame], frame).toEqual([`${atom} value`])
      expect(Object.keys(tags).filter((key) => /sort_/i.test(key))).toEqual([])
    },
  )

  it('keeps its atoms converted to FLAC', async () => {
    const xiph = vorbis(await convert(tagged(codec), 'flac'))
    for (const [, name, values] of FREEFORM) expect(xiph.getField(name), name).toEqual(values)
    for (const [atom, , field] of ATOMS)
      expect(xiph.getField(field), field).toEqual([`${atom} value`])
    expect(xiph.fieldNames.filter((name) => /sort_/i.test(name))).toEqual([])
  })

  it.each(['mp3', 'wav', 'flac'] as OutputFormat[])(
    'does not bring back what the DJ deleted or cleared converting to %s',
    async (target) => {
      const kept = await convert(tagged(codec), target, {
        foreignRemoved: ['SINGLE', 'sort_artist'],
      })
      const cleared = await convert(tagged(codec), target, { clearExtras: true })
      if (target === 'flac') {
        expect(vorbis(kept).getField('SINGLE')).toEqual([])
        expect(vorbis(kept).getField('ARTISTSORT')).toEqual([])
        expect(vorbis(kept).getField('ALBUMSORT')).toEqual(['soal value'])
        expect(vorbis(cleared).getField('ALBUMSORT')).toEqual([])
      } else {
        expect(id3Tags(kept)['TXXX:SINGLE']).toBeUndefined()
        expect(id3Tags(kept).TSOP).toBeUndefined()
        expect(id3Tags(kept).TSOA).toEqual(['soal value'])
        expect(id3Tags(cleared).TSOA).toBeUndefined()
      }
    },
  )
})
