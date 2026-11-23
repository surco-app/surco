import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ByteVector,
  Id3v2FrameClassType,
  Id3v2FrameIdentifiers,
  type Id3v2Tag,
  Id3v2TextInformationFrame,
  Id3v2UserTextInformationFrame,
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
import type { OutputFormat, TrackMetadata } from '../shared/types'
import { convertAudio, readMeta } from './ffmpeg'
import { encodeSine } from './sineTone.fixture'

const dir = mkdtempSync(join(tmpdir(), 'surco-unmanaged-'))
const ITUNES = 'com.apple.iTunes'
let n = 0

const TXXX: [string, string[]][] = [
  ['MUSICBRAINZ ARTIST ID', ['id-1', 'id-2']],
  ['X', ['7', '8']],
  ['SINGLE', ['one']],
  ['REPEATED', ['a']],
  ['REPEATED', ['b']],
  ['VINYLCONDITION', ['VG+']],
  ['STYLE', ['Deep', 'Dark']],
]

const SORTS = [
  ['TSOP', 'soar'],
  ['TSOA', 'soal'],
  ['TSOT', 'sonm'],
] as const

function id3Source(ext: 'mp3' | 'aiff' | 'wav'): string {
  const path = encodeSine(dir, `src${n++}`, ext)
  const f = TagFile.createFromPath(path)
  const id3 = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
  id3.version = 4
  for (const [description, values] of TXXX) {
    const frame = Id3v2UserTextInformationFrame.fromDescription(description)
    frame.text = values
    id3.addFrame(frame)
  }
  for (const id of [...SORTS.map(([frame]) => frame), 'TLAN'] as const) {
    const frame = Id3v2TextInformationFrame.fromIdentifier(Id3v2FrameIdentifiers[id])
    frame.text = [`${id} 1`, `${id} 2`]
    id3.addFrame(frame)
  }
  f.save()
  f.dispose()
  return path
}

function flacSource(): string {
  const path = encodeSine(dir, `src${n++}`, 'flac')
  const f = TagFile.createFromPath(path)
  const xiph = f.getTag(TagTypes.Xiph, true) as XiphComment
  xiph.setFieldAsStrings('MUSICBRAINZ_ARTISTID', 'id-1', 'id-2')
  xiph.setFieldAsStrings('SINGLE', 'one')
  xiph.setFieldAsStrings('ENCODER', 'Lavf60.3.100')
  xiph.setFieldAsStrings('SOFTWARE', 'Previous owner')
  f.save()
  f.dispose()
  return path
}

function userText(path: string): Record<string, string[]> {
  const f = TagFile.createFromPath(path)
  try {
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
    const out: Record<string, string[]> = {}
    for (const frame of id3?.getFramesByClassType<Id3v2UserTextInformationFrame>(
      Id3v2FrameClassType.UserTextInformationFrame,
    ) ?? [])
      out[frame.description] = [...(out[frame.description] ?? []), ...frame.text]
    return out
  } finally {
    f.dispose()
  }
}

function frameText(path: string, id: string): string[] {
  const f = TagFile.createFromPath(path)
  try {
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
    const frame = id3?.frames.find((fr) => fr.frameId.toString() === id)
    return frame ? [...(frame as Id3v2TextInformationFrame).text] : []
  } finally {
    f.dispose()
  }
}

function freeform(path: string, name: string): string[] {
  const f = TagFile.createFromPath(path)
  try {
    return (f.tag as Mpeg4AppleTag).getItunesStrings(ITUNES, name)
  } finally {
    f.dispose()
  }
}

function sortAtoms(path: string): string[][] {
  const f = TagFile.createFromPath(path)
  try {
    return SORTS.map(([, atom]) =>
      (f.tag as Mpeg4AppleTag).getQuickTimeStrings(ByteVector.fromString(atom, StringType.Latin1)),
    )
  } finally {
    f.dispose()
  }
}

async function edited(path: string, changes: Partial<TrackMetadata> = {}): Promise<TrackMetadata> {
  return { ...emptyMetadata(), ...(await readMeta(path)).tags, title: 'New title', ...changes }
}

function convert(
  path: string,
  target: OutputFormat,
  meta: TrackMetadata,
  options: { clearExtras?: boolean; foreignRemoved?: string[] } = {},
): Promise<string> {
  const out = join(dir, `out${n++}.${target === 'alac' ? 'm4a' : target}`)
  return convertAudio(
    path,
    out,
    target,
    meta,
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
  ).then(() => out)
}

const UNMANAGED = TXXX.filter(([name]) => !['STYLE', 'REPEATED', 'VINYLCONDITION'].includes(name))

// Measured 23/11/2026 with the bundled ffmpeg, source by target: an MP3, AIFF or WAV moving
// to MP3 or AIFF kept only the first value of every TXXX and text frame another program
// wrote, and its sort names turned into TXXX "artist-sort" frames nothing reads; to WAV or
// ALAC it lost every one of them, as a FLAC's comments did. A same-format MP3 or AIFF update
// dropped the sort names too, which ID3v2.3 has no standard frame for. Tags Surco does not
// manage are the DJ's own and must come out of Surco whole whatever format they cross into.
describe.each(['mp3', 'aiff', 'wav'] as const)('an ID3v2.4 %s', (ext) => {
  describe.each(['mp3', 'aiff', 'wav'] as const)('converted to %s', (target) => {
    it('keeps every value of a tag Surco does not manage', async () => {
      const src = id3Source(ext)
      const out = await convert(src, target, await edited(src))
      const txxx = userText(out)
      for (const [name, values] of UNMANAGED) expect(txxx[name], name).toEqual(values)
      expect(txxx.REPEATED).toEqual(['a', 'b'])
      expect(Object.keys(txxx).filter((name) => /-sort$/i.test(name))).toEqual([])
      // ID3v2.3 keeps a text frame's values joined by '/', which TagLib splits back for TSOP.
      for (const id of [...SORTS.map(([frame]) => frame), 'TLAN'])
        expect(frameText(out, id).join('/'), id).toBe(`${id} 1/${id} 2`)
    })

    it('leaves a field Surco writes as Surco wrote it', async () => {
      const src = id3Source(ext)
      const out = await convert(src, target, await edited(src, { style: 'Minimal' }))
      expect(userText(out).STYLE).toEqual(['Minimal'])
    })

    it('does not bring back a tag the DJ deleted, emptied or cleared with the rest', async () => {
      const src = id3Source(ext)
      const meta = await edited(src, { custom: { vinylCondition: '' } })
      const kept = await convert(src, target, meta, { foreignRemoved: ['X', 'artist-sort'] })
      expect(userText(kept).X).toBeUndefined()
      expect(userText(kept).VINYLCONDITION).toBeUndefined()
      expect(frameText(kept, 'TSOP')).toEqual([])
      expect(userText(kept)['MUSICBRAINZ ARTIST ID']).toEqual(['id-1', 'id-2'])

      const cleared = await convert(src, target, emptyMetadata(), { clearExtras: true })
      expect(userText(cleared)).toEqual({})
      expect(frameText(cleared, 'TSOP')).toEqual([])
    })
  })

  describe('converted to ALAC', () => {
    it('keeps every value of a tag Surco does not manage', async () => {
      const src = id3Source(ext)
      const out = await convert(src, 'alac', await edited(src))
      for (const [name, values] of UNMANAGED) expect(freeform(out, name), name).toEqual(values)
      expect(freeform(out, 'REPEATED')).toEqual(['a', 'b'])
      expect(freeform(out, 'LANGUAGE')).toEqual(['TLAN 1', 'TLAN 2'])
      expect(sortAtoms(out)).toEqual(SORTS.map(([id]) => [`${id} 1`, `${id} 2`]))
    })

    it('does not bring back a tag Surco writes, the DJ deleted or cleared with the rest', async () => {
      const src = id3Source(ext)
      const meta = await edited(src, { style: 'Minimal', custom: { vinylCondition: '' } })
      const kept = await convert(src, 'alac', meta, { foreignRemoved: ['X', 'artist-sort'] })
      expect(freeform(kept, 'STYLE')).toEqual(['Minimal'])
      expect(freeform(kept, 'X')).toEqual([])
      expect(freeform(kept, 'VINYLCONDITION')).toEqual([])
      expect(sortAtoms(kept)[0]).toEqual([])

      const cleared = await convert(src, 'alac', emptyMetadata(), { clearExtras: true })
      expect(freeform(cleared, 'MUSICBRAINZ ARTIST ID')).toEqual([])
      expect(sortAtoms(cleared)[0]).toEqual([])
    })
  })
})

describe('a FLAC', () => {
  it.each(['mp3', 'aiff', 'wav'] as const)('keeps its comments converted to %s', async (target) => {
    const src = flacSource()
    const out = await convert(src, target, await edited(src))
    const txxx = userText(out)
    expect(txxx.MUSICBRAINZ_ARTISTID).toEqual(['id-1', 'id-2'])
    expect(txxx.SINGLE).toEqual(['one'])
    expect(txxx.ENCODER).toBeUndefined()
    expect(txxx.SOFTWARE).toBeUndefined()
  })

  // Serato's comments are carrySeratoCues' to translate or drop, and a FLAC keeps its own
  // comments without an ID3 tag in front of them.
  it.each(['wav', 'alac'] as const)(
    'leaves Serato data to its own carry converting to %s',
    async (target) => {
      const src = flacSource()
      const f = TagFile.createFromPath(src)
      ;(f.getTag(TagTypes.Xiph, true) as XiphComment).setFieldAsStrings('SERATO_ANALYSIS', 'AgE=')
      f.save()
      f.dispose()
      const out = await convert(src, target, await edited(src))
      expect(Object.keys(userText(out)).filter((name) => /^serato_/i.test(name))).toEqual([])
      if (target === 'alac') expect(freeform(out, 'SERATO_ANALYSIS')).toEqual([])
    },
  )

  it('takes no ID3 tag converted from an MP3 to FLAC', async () => {
    const out = await convert(id3Source('mp3'), 'flac', emptyMetadata())
    const f = TagFile.createFromPath(out)
    expect(f.tagTypesOnDisk & TagTypes.Id3v2).toBe(0)
    f.dispose()
  })

  it('keeps its comments converted to ALAC', async () => {
    const src = flacSource()
    const out = await convert(src, 'alac', await edited(src))
    expect(freeform(out, 'MUSICBRAINZ_ARTISTID')).toEqual(['id-1', 'id-2'])
    expect(freeform(out, 'SINGLE')).toEqual(['one'])
    expect(freeform(out, 'ENCODER')).toEqual([])
    expect(freeform(out, 'SOFTWARE')).toEqual([])
  })
})
