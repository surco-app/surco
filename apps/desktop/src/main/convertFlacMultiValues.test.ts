import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  Id3v2FrameIdentifiers,
  type Id3v2Tag,
  Id3v2TextInformationFrame,
  Id3v2UserTextInformationFrame,
  File as TagFile,
  TagTypes,
  type XiphComment,
} from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { emptyMetadata } from '../shared/metadata'
import type { TrackMetadata } from '../shared/types'
import { convertAudio, readMeta } from './ffmpeg'
import { encodeSine } from './sineTone.fixture'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-flac-multi-'))

let n = 0
function flacWith(fields: Record<string, string[]>, encode: string[] = []): string {
  const path = join(dir, `track${n++}.flac`)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    ...encode,
    path,
  ])
  const f = TagFile.createFromPath(path)
  const xiph = f.getTag(TagTypes.Xiph, true) as XiphComment
  for (const [name, values] of Object.entries(fields)) xiph.setFieldAsStrings(name, ...values)
  f.save()
  f.dispose()
  return path
}

function field(path: string, name: string): string[] {
  const f = TagFile.createFromPath(path)
  try {
    return (f.getTag(TagTypes.Xiph, false) as XiphComment | null)?.getField(name) ?? []
  } finally {
    f.dispose()
  }
}

async function editedTitle(path: string): Promise<TrackMetadata> {
  return { ...emptyMetadata(), ...(await readMeta(path)).tags, title: 'New title' }
}

const update = (
  path: string,
  meta: TrackMetadata,
  options: { clearExtras?: boolean; foreignRemoved?: string[] } = {},
) =>
  convertAudio(
    path,
    path,
    'flac',
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
  )

// Measured 23/11/2026 with the bundled ffmpeg: its FLAC reader folds the entries of a
// repeated Vorbis comment into one value joined by ';', and the muxer writes that back, so
// a title edit turned another program's two MUSICBRAINZ_ARTISTID entries into one id
// nothing can look up. Tags Surco does not manage are the DJ's own and must come out of
// Surco as they went in, whether the audio was copied or re-encoded.
describe('a FLAC written from a FLAC', () => {
  const MULTI = {
    MUSICBRAINZ_ARTISTID: ['id-1', 'id-2'],
    ARTISTS: ['Ann', 'Bob'],
    X: ['7', '8'],
  }

  it('keeps every entry of a repeated comment Surco does not manage', async () => {
    const src = flacWith({ ...MULTI, SINGLE: ['one'] })
    await update(src, await editedTitle(src))
    for (const [name, values] of Object.entries(MULTI))
      expect(field(src, name), name).toEqual(values)
    expect(field(src, 'SINGLE')).toEqual(['one'])
    expect(field(src, 'TITLE')).toEqual(['New title'])
  })

  it('keeps them when the conversion re-encodes the audio', async () => {
    const src = flacWith(MULTI, ['-ar', '48000', '-sample_fmt', 's32'])
    await convertAudio(src, src, 'flac', await editedTitle(src), undefined, undefined, undefined, {
      bitDepth: '16',
      sampleRate: '44100',
    })
    for (const [name, values] of Object.entries(MULTI))
      expect(field(src, name), name).toEqual(values)
  })

  // A field Surco writes holds what the editor holds, one value; the source's entries must
  // not come back over it.
  it('leaves a field Surco writes as Surco wrote it', async () => {
    const src = flacWith({ GENRE: ['House', 'Techno'], STYLE: ['Deep', 'Dark'] })
    const meta = { ...(await editedTitle(src)), style: 'Minimal' }
    await update(src, meta)
    expect(field(src, 'GENRE')).toEqual(['House;Techno'])
    expect(field(src, 'STYLE')).toEqual(['Minimal'])
  })

  it('does not bring back a tag the DJ deleted or a file the DJ emptied', async () => {
    const deleted = flacWith(MULTI)
    await update(deleted, await editedTitle(deleted), { foreignRemoved: ['x'] })
    expect(field(deleted, 'X')).toEqual([])
    expect(field(deleted, 'ARTISTS')).toEqual(['Ann', 'Bob'])

    const emptied = flacWith(MULTI)
    await update(emptied, emptyMetadata(), { clearExtras: true })
    for (const name of Object.keys(MULTI)) expect(field(emptied, name), name).toEqual([])
  })
})

function id3With(ext: 'mp3' | 'aiff' | 'wav', version: 3 | 4, txxx: [string, string[]][]): string {
  const path = encodeSine(dir, `track${n++}`, ext)
  const f = TagFile.createFromPath(path)
  const id3 = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
  id3.version = version
  for (const [description, values] of txxx) {
    const frame = Id3v2UserTextInformationFrame.fromDescription(description)
    frame.text = values
    id3.addFrame(frame)
  }
  if (version === 4) {
    id3.performersSort = ['Ann', 'Bob']
    const language = Id3v2TextInformationFrame.fromIdentifier(Id3v2FrameIdentifiers.TLAN)
    language.text = ['eng', 'spa']
    id3.addFrame(language)
  }
  f.save()
  f.dispose()
  return path
}

const toFlac = (
  path: string,
  meta: TrackMetadata,
  options: { clearExtras?: boolean; foreignRemoved?: string[] } = {},
) => {
  const out = join(dir, `track${n++}.flac`)
  return convertAudio(
    path,
    out,
    'flac',
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

// Measured 23/11/2026 with the bundled ffmpeg: its ID3 reader keeps only the first value of
// a multi-valued frame (ID3v2.4 separates them with a null) and only the first of two TXXX
// frames sharing a description, so an MP3, AIFF or WAV converted to FLAC lost the second
// MusicBrainz id, artist sort name or language another program wrote. The DJ's own tags must
// come out of Surco whole whatever format they cross into.
describe.each(['mp3', 'aiff', 'wav'] as const)('a FLAC written from an ID3 %s', (ext) => {
  const MULTI: [string, string[]][] = [
    ['MUSICBRAINZ ARTIST ID', ['id-1', 'id-2']],
    ['X', ['7', '8']],
  ]

  it('keeps every value of a tag Surco does not manage', async () => {
    const src = id3With(ext, 4, [
      ...MULTI,
      ['REPEATED', ['a']],
      ['REPEATED', ['b']],
      ['SINGLE', ['one']],
    ])
    const out = await toFlac(src, await editedTitle(src))
    for (const [name, values] of MULTI) expect(field(out, name), name).toEqual(values)
    expect(field(out, 'REPEATED')).toEqual(['a', 'b'])
    expect(field(out, 'ARTIST-SORT')).toEqual(['Ann', 'Bob'])
    expect(field(out, 'LANGUAGE')).toEqual(['eng', 'spa'])
    expect(field(out, 'SINGLE')).toEqual(['one'])
    expect(field(out, 'TITLE')).toEqual(['New title'])
  })

  // An ID3v2.3 text value is one string; a slash or semicolon inside it is the DJ's text,
  // not a separator Surco may split on.
  it('keeps an ID3v2.3 value with a separator in it as one value', async () => {
    const src = id3With(ext, 3, [
      ['SLASH', ['7/8']],
      ['SEMI', ['7;8']],
    ])
    const out = await toFlac(src, await editedTitle(src))
    expect(field(out, 'SLASH')).toEqual(['7/8'])
    expect(field(out, 'SEMI')).toEqual(['7;8'])
  })

  // A field Surco writes holds what the editor holds, one value, even untouched: the
  // source's other values must not come back over it.
  it('leaves a field Surco writes as Surco wrote it', async () => {
    const src = id3With(ext, 4, [
      ['STYLE', ['Deep', 'Dark']],
      ['CATALOGNUMBER', ['CAT-1', 'CAT-2']],
    ])
    const meta = { ...(await editedTitle(src)), style: 'Minimal' }
    const out = await toFlac(src, meta)
    expect(field(out, 'STYLE')).toEqual(['Minimal'])
    expect(field(out, 'CATALOGNUMBER')).toEqual([meta.catalogNumber])
  })

  it('does not bring back a tag the DJ deleted or a file the DJ emptied', async () => {
    const deleted = id3With(ext, 4, MULTI)
    const kept = await toFlac(deleted, await editedTitle(deleted), { foreignRemoved: ['x'] })
    expect(field(kept, 'X')).toEqual([])
    expect(field(kept, 'MUSICBRAINZ ARTIST ID')).toEqual(['id-1', 'id-2'])

    const emptied = id3With(ext, 4, MULTI)
    const cleared = await toFlac(emptied, emptyMetadata(), { clearExtras: true })
    for (const name of ['MUSICBRAINZ ARTIST ID', 'X', 'ARTIST-SORT', 'LANGUAGE'])
      expect(field(cleared, name), name).toEqual([])
  })
})
