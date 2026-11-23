import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  Id3v2FrameClassType,
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
import { convertAudio, readMeta, readTags } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-id3-multi-'))

const ENCODE = { mp3: ['-c:a', 'libmp3lame', '-b:a', '128k'], aiff: [], wav: [] }
type Ext = keyof typeof ENCODE

let n = 0
function taggedWith(ext: Ext, version: number, lists: Partial<Record<ListKey, string[]>>): string {
  const path = join(dir, `track${n++}.${ext}`)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    ...ENCODE[ext],
    path,
  ])
  const f = TagFile.createFromPath(path)
  const id3 = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
  id3.version = version
  id3.title = 'Old title'
  for (const [key, values] of Object.entries(lists)) id3[key as ListKey] = values
  f.save()
  f.dispose()
  return path
}

type ListKey = 'performers' | 'genres' | 'albumArtists' | 'composers'

const FRAME: Record<ListKey, string> = {
  performers: 'TPE1',
  genres: 'TCON',
  albumArtists: 'TPE2',
  composers: 'TCOM',
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

const LISTS = {
  performers: ['Ann', 'Bob'],
  genres: ['House', 'Techno'],
  albumArtists: ['Ann', 'Cid'],
  composers: ['C1', 'C2'],
}

// Measured 23/11/2026 with the bundled ffprobe: an ID3v2.4 text frame holding several
// values ("Ann\0Bob", what Picard, foobar2000 and beets write) probes as its first value
// alone. The editor showed "Ann", and the next save, a title edit included, wrote "Ann"
// back as the whole artist: Bob, the second genre, the other composer were gone for good.
// A title edit must never delete the artists or genres the DJ had. The values come back
// joined by ';', as a FLAC's repeated comments already read.
describe.each(['mp3', 'aiff', 'wav'] as const)(
  'an ID3v2.4 %s with several values in a frame',
  (ext) => {
    it('shows every value in the editor', async () => {
      const tags = (await readMeta(taggedWith(ext, 4, LISTS))).tags
      expect(tags.artist).toBe('Ann;Bob')
      expect(tags.genre).toBe('House;Techno')
      expect(tags.albumArtist).toBe('Ann;Cid')
      expect(tags.composer).toBe('C1;C2')
    })

    // The tags an update and the replaced copy's fill read: they are written back too.
    it('reads every value through readTags as well', async () => {
      const tags = await readTags(taggedWith(ext, 4, LISTS))
      expect(tags.artist).toBe('Ann;Bob')
      expect(tags.genre).toBe('House;Techno')
    })

    it('keeps every value through a save that only edits the title', async () => {
      const path = taggedWith(ext, 4, LISTS)
      const meta = { ...emptyMetadata(), ...(await readMeta(path)).tags, title: 'New title' }
      await convertAudio(path, path, ext, meta)
      for (const [key, values] of Object.entries(LISTS))
        expect(frameText(path, FRAME[key as ListKey]), key).toEqual([values.join(';')])
      expect(frameText(path, 'TIT2')).toEqual(['New title'])
    })
  },
)

describe('an ID3 frame holding one value', () => {
  it('reads as it did', async () => {
    const tags = (await readMeta(taggedWith('mp3', 4, { performers: ['Ann, Bob'] }))).tags
    expect(tags.artist).toBe('Ann, Bob')
  })

  // A FLAC's editor reads its Vorbis comment; an ID3 tag some old tagger left in front of
  // it is not what the DJ edits.
  it('leaves a FLAC to its Vorbis comment', async () => {
    const path = join(dir, `track${n++}.flac`)
    execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc', '-t', '1', path])
    const f = TagFile.createFromPath(path)
    ;(f.getTag(TagTypes.Xiph, true) as XiphComment).setFieldAsStrings('ARTIST', 'Vorbis')
    const id3 = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
    id3.version = 4
    id3.performers = ['Ann', 'Bob']
    f.save()
    f.dispose()
    expect((await readMeta(path)).tags.artist).toBe('Vorbis')
  })

  it('keeps a v2.3 slash, which the probe already reads whole', async () => {
    const tags = (await readMeta(taggedWith('mp3', 3, { performers: ['Ann', 'Bob'] }))).tags
    expect(tags.artist).toBe('Ann/Bob')
  })

  // The INFO title is the one Traktor and the probe read on a WAV; an ID3 frame holding one
  // value has nothing the probe missed.
  it('leaves a WAV title to its INFO list when the ID3 frame holds one value', async () => {
    const path = taggedFrames('wav', {}, {})
    const f = TagFile.createFromPath(path)
    f.getTag(TagTypes.RiffInfo, true).title = 'Info title'
    f.save()
    f.dispose()
    expect((await readMeta(path)).tags.title).toBe('Info title')
  })

  it('does not write a stray ID3 tag over the FLAC artist the DJ left', async () => {
    const path = strayId3Flac()
    const meta = { ...emptyMetadata(), ...(await readMeta(path)).tags, artist: 'Ann' }
    await convertAudio(path, path, 'flac', meta)
    expect(vorbisField(path, 'ARTIST')).toEqual(['Ann'])
  })
})

function strayId3Flac(): string {
  const path = join(dir, `track${n++}.flac`)
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc', '-t', '1', path])
  const f = TagFile.createFromPath(path)
  ;(f.getTag(TagTypes.Xiph, true) as XiphComment).setFieldAsStrings('ARTIST', 'Vorbis')
  const id3 = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
  id3.version = 4
  id3.performers = ['Ann', 'Bob']
  f.save()
  f.dispose()
  return path
}

function vorbisField(path: string, name: string): string[] {
  const f = TagFile.createFromPath(path)
  try {
    return (f.getTag(TagTypes.Xiph, false) as XiphComment | null)?.getField(name) ?? []
  } finally {
    f.dispose()
  }
}

// What the editor still shows for a file read before every value was: readMeta's cache is
// keyed by the file's path and mtime, so an untouched file keeps serving the first value.
// Moving the cache to a new namespace would re-read every library, so the save itself has
// to tell an untouched truncated field from one the DJ edited.
const TRUNCATED = { artist: 'Ann', genre: 'House', albumArtist: 'Ann', composer: 'C1' }

async function truncatedRead(path: string): Promise<TrackMetadata> {
  return { ...emptyMetadata(), ...(await readMeta(path)).tags, ...TRUNCATED, title: 'New title' }
}

const clearing = (path: string, ext: Ext, meta: TrackMetadata) =>
  convertAudio(
    path,
    path,
    ext,
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
    true,
  )

describe.each(['mp3', 'aiff', 'wav'] as const)(
  'a save of an ID3v2.4 %s from a read that kept only the first value',
  (ext) => {
    it('keeps every value of a field the DJ did not change', async () => {
      const path = taggedWith(ext, 4, LISTS)
      await convertAudio(path, path, ext, await truncatedRead(path))
      for (const [key, values] of Object.entries(LISTS))
        expect(frameText(path, FRAME[key as ListKey]), key).toEqual([values.join(';')])
      expect(frameText(path, 'TIT2')).toEqual(['New title'])
    })

    it.each(['mp3', 'aiff', 'wav'] as const)('keeps them converting to %s', async (target) => {
      const path = taggedWith(ext, 4, LISTS)
      const out = join(dir, `out${n++}.${target}`)
      await convertAudio(path, out, target, await truncatedRead(path))
      for (const [key, values] of Object.entries(LISTS))
        expect(frameText(out, FRAME[key as ListKey]), key).toEqual([values.join(';')])
    })

    it('keeps them converting to FLAC', async () => {
      const path = taggedWith(ext, 4, LISTS)
      const out = join(dir, `out${n++}.flac`)
      await convertAudio(path, out, 'flac', await truncatedRead(path))
      expect(vorbisField(out, 'ARTIST')).toEqual(['Ann;Bob'])
      expect(vorbisField(out, 'GENRE')).toEqual(['House;Techno'])
    })

    it('writes what the DJ changed the field to', async () => {
      const path = taggedWith(ext, 4, LISTS)
      const meta = { ...(await truncatedRead(path)), artist: 'Zed', genre: '' }
      await convertAudio(path, path, ext, meta)
      expect(frameText(path, 'TPE1')).toEqual(['Zed'])
      expect(frameText(path, 'TCON')).toEqual([])
      expect(frameText(path, 'TPE2')).toEqual(['Ann;Cid'])
    })

    it('writes only what the DJ refilled after emptying every field', async () => {
      const path = taggedWith(ext, 4, LISTS)
      await clearing(path, ext, { ...emptyMetadata(), artist: 'Ann' })
      expect(frameText(path, 'TPE1')).toEqual(['Ann'])
      expect(frameText(path, 'TCON')).toEqual([])
    })
  },
)

const TEXT_FRAMES: Record<string, string> = {
  title: 'TIT2',
  album: 'TALB',
  grouping: 'TIT1',
  key: 'TKEY',
  publisher: 'TPUB',
  remixArtist: 'TPE4',
  isrc: 'TSRC',
  mixName: 'TIT3',
  originalArtist: 'TOPE',
  lyricist: 'TEXT',
  conductor: 'TPE3',
  copyright: 'TCOP',
  encodedBy: 'TENC',
}

const USER_TEXT: Record<string, string> = {
  catalogNumber: 'CATALOGNUMBER',
  discogsReleaseId: 'DISCOGS_RELEASE_ID',
  mood: 'MOOD',
  energy: 'ENERGY',
  style: 'STYLE',
  country: 'COUNTRY',
  quality: 'QUALITY',
  mediaType: 'MEDIATYPE',
  discogsUrl: 'DISCOGS_RELEASE_URL',
}

const valuesOf = (name: string) => [`${name} 1`, `${name} 2`]

function taggedFrames(ext: Ext, frames: Record<string, string>, userText: Record<string, string>) {
  const path = taggedWith(ext, 4, {})
  const f = TagFile.createFromPath(path)
  const id3 = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
  for (const id of Object.values(frames)) {
    const identifier = Id3v2FrameIdentifiers[id as keyof typeof Id3v2FrameIdentifiers]
    id3.removeFrames(identifier)
    const frame = Id3v2TextInformationFrame.fromIdentifier(identifier)
    frame.text = valuesOf(id)
    id3.addFrame(frame)
  }
  for (const description of Object.values(userText)) {
    const frame = Id3v2UserTextInformationFrame.fromDescription(description)
    frame.text = valuesOf(description)
    id3.addFrame(frame)
  }
  f.save()
  f.dispose()
  return path
}

function userTextOf(path: string, description: string): string[] {
  const f = TagFile.createFromPath(path)
  try {
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
    const frames = id3?.getFramesByClassType<Id3v2UserTextInformationFrame>(
      Id3v2FrameClassType.UserTextInformationFrame,
    )
    const frame = frames?.find((fr) => fr.description === description)
    return frame ? [...frame.text] : []
  } finally {
    f.dispose()
  }
}

function expectEveryValue(path: string) {
  for (const [key, id] of Object.entries(TEXT_FRAMES))
    expect(frameText(path, id), key).toEqual([valuesOf(id).join(';')])
  for (const [key, description] of Object.entries(USER_TEXT))
    expect(userTextOf(path, description), key).toEqual([valuesOf(description).join(';')])
}

// Measured 23/11/2026 with the bundled ffprobe: the first-value-only read was not the
// artists' and genres' alone. Every text frame and TXXX a managed field rides came back cut
// to its first value, the label (TPUB), the key (TKEY), the style and mood a Discogs tagger
// writes as several, and the next save wrote that first value back as the whole field.
describe.each(['mp3', 'aiff', 'wav'] as const)(
  'an ID3v2.4 %s with several values in a field Surco manages',
  (ext) => {
    it('shows every value in the editor', async () => {
      const tags = (await readMeta(taggedFrames(ext, TEXT_FRAMES, USER_TEXT))).tags
      for (const [key, id] of Object.entries({ ...TEXT_FRAMES, ...USER_TEXT }))
        expect(tags[key as keyof typeof tags], key).toBe(valuesOf(id).join(';'))
    })

    it('reads the mood from a TMOO frame whole', async () => {
      const tags = (await readMeta(taggedFrames(ext, { mood: 'TMOO' }, {}))).tags
      expect(tags.mood).toBe(valuesOf('TMOO').join(';'))
    })

    it('keeps every value through a save that only edits the comment', async () => {
      const path = taggedFrames(ext, TEXT_FRAMES, USER_TEXT)
      const meta = { ...emptyMetadata(), ...(await readMeta(path)).tags, comment: 'New comment' }
      await convertAudio(path, path, ext, meta)
      expectEveryValue(path)
    })

    it('keeps every value saving from a read that kept only the first', async () => {
      const path = taggedFrames(ext, TEXT_FRAMES, USER_TEXT)
      const firsts = Object.fromEntries(
        Object.entries({ ...TEXT_FRAMES, ...USER_TEXT }).map(([key, id]) => [key, valuesOf(id)[0]]),
      )
      const meta = { ...emptyMetadata(), ...(await readMeta(path)).tags, ...firsts }
      const out = join(dir, `out${n++}.flac`)
      await convertAudio(path, out, 'flac', meta)
      expect(vorbisField(out, 'LABEL')).toEqual([valuesOf('TPUB').join(';')])
      expect(vorbisField(out, 'STYLE')).toEqual([valuesOf('STYLE').join(';')])
      await convertAudio(path, path, ext, meta)
      expectEveryValue(path)
    })

    it('writes what the DJ changed the field to', async () => {
      const path = taggedFrames(ext, TEXT_FRAMES, USER_TEXT)
      const meta = { ...emptyMetadata(), ...(await readMeta(path)).tags, key: '8A', style: '' }
      await convertAudio(path, path, ext, meta)
      expect(frameText(path, 'TKEY')).toEqual(['8A'])
      expect(userTextOf(path, 'STYLE')).toEqual([])
    })
  },
)
