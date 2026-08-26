import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  Id3v2CommentsFrame,
  Id3v2PopularimeterFrame,
  type Id3v2Tag,
  Id3v2UserTextInformationFrame,
  File as TagFile,
  TagTypes,
} from 'node-taglib-sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { TrackMetadata } from '../shared/types'
import { convertAudio, readMeta } from './ffmpeg'

const FF = ffmpegStatic as unknown as string

const meta: TrackMetadata = {
  title: 'Someone, Somewhere',
  artist: 'Two Powers',
  album: '',
  albumArtist: '',
  year: '',
  genre: '',
  grouping: '',
  comment: '11A - Energy 7',
  trackNumber: '',
  discNumber: '',
  bpm: '',
  key: '11A',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
}

let dir: string
let source: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'surco-keycomment-'))
  source = join(dir, 'source.flac')
  // A source already carrying a COMMENT from another tagger — the state every file djotas
  // feeds Surco is in, since Traktor and Mixed In Key both write one.
  execFileSync(FF, [
    '-v',
    'quiet',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-metadata',
    'COMMENT=stale from another tagger',
    '-y',
    source,
  ])
})

// The field NAMES as they sit in the file, which is what a program matching on them sees.
// ffprobe normalises Vorbis spellings on read — COMMENT and DESCRIPTION both surface as
// "comment", KEY and INITIALKEY both as "key" — so only the raw bytes answer this.
function rawVorbisFields(path: string): string[] {
  const text = readFileSync(path).toString('latin1')
  return [...text.matchAll(/(INITIALKEY|KEY|COMMENT|DESCRIPTION)=/g)].map((m) => m[1])
}

// The ID3 counterparts of rawVorbisFields. An ID3 container gets written twice on a
// conversion — ffmpeg muxes the tag, then writeTags reopens it — so what matters is not
// that the value is right but that it appears once. mp3tag shows a second frame as a
// second row, which is exactly what djotas photographed.
function id3Frames(path: string): Id3v2Tag | null {
  const f = TagFile.createFromPath(path)
  try {
    return f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
  } finally {
    f.dispose()
  }
}

function commentCount(path: string): number {
  return (id3Frames(path)?.frames ?? []).filter((fr) => fr instanceof Id3v2CommentsFrame).length
}

// Every way a rating can show up under the name mp3tag prints as "RATING WMP": the POPM
// frame Surco writes on purpose, and the TXXX ffmpeg copies over from the source's Vorbis
// field. Counted together because the user sees one list, not two frame families.
function txxxComments(path: string): string[] {
  return (id3Frames(path)?.frames ?? [])
    .filter((fr) => fr instanceof Id3v2UserTextInformationFrame && fr.description === 'comment')
    .map((fr) => (fr as Id3v2UserTextInformationFrame).text?.[0] ?? '')
}

function wmpRatingRows(path: string): string[] {
  const rows: string[] = []
  for (const fr of id3Frames(path)?.frames ?? []) {
    if (fr instanceof Id3v2PopularimeterFrame && fr.user.includes('Windows Media Player'))
      rows.push(`POPM:${fr.rating}`)
    if (fr instanceof Id3v2UserTextInformationFrame && fr.description === 'RATING WMP')
      rows.push(`TXXX:${fr.text?.[0]}`)
  }
  return rows
}

// djotas, correcting what he told us earlier: "initialkey no es, es key". His mp3tag dump
// of a converted file shows both spellings carrying the same value, so dropping INITIALKEY
// would blind whatever reads that one — the same both-spellings bargain the record label
// already strikes with LABEL/PUBLISHER.
describe('a FLAC conversion writes the musical key where Traktor reads it', () => {
  it('carries KEY, not only INITIALKEY', async () => {
    const out = join(dir, 'key.flac')
    await convertAudio(source, out, 'flac', meta)

    const names = rawVorbisFields(out)
    expect(names).toContain('KEY')
    expect(names).toContain('INITIALKEY')
  })

  it('reads its own key back', async () => {
    const out = join(dir, 'key-roundtrip.flac')
    await convertAudio(source, out, 'flac', meta)

    expect((await readMeta(out)).tags.key).toBe('11A')
  })
})

// The ID3 half of the same bargain, reported by djotas with an mp3tag screenshot of a
// converted MP3 and AIFF: two COMMENT rows holding the identical text. A conversion writes
// the tag twice — ffmpeg muxes a COMM with language "eng", then writeTags sets tag.comment,
// whose TagLib setter matches the frame to reuse by language against Id3v2Tag.language,
// which the project never initialises. The mismatch makes it add a second frame instead of
// reusing the first, so the value is right and the file carries it twice.
describe('an ID3 conversion leaves exactly one comment', () => {
  // Rated, because that is what puts a file through the TagLib pass at all — and every
  // file djotas converts is rated. The unrated path never reopens the tag, so its comment
  // stays in the TXXX ffmpeg wrote and no duplicate can arise there.
  it('writes a single COMM frame to a rated mp3', async () => {
    const out = join(dir, 'comment.mp3')
    await convertAudio(source, out, 'mp3', { ...meta, rating: '5' })

    expect(commentCount(out)).toBe(1)
    expect(txxxComments(out)).toEqual([])
  })

  it('writes a single COMM frame to a rated aiff', async () => {
    const out = join(dir, 'comment.aiff')
    await convertAudio(source, out, 'aiff', { ...meta, rating: '5' })

    expect(commentCount(out)).toBe(1)
    expect(txxxComments(out)).toEqual([])
  })

  it('keeps the comment readable after the conversion', async () => {
    const out = join(dir, 'comment-id3-roundtrip.mp3')
    await convertAudio(source, out, 'mp3', { ...meta, rating: '5' })

    expect((await readMeta(out)).tags.comment).toBe('11A - Energy 7')
  })
})

// The other duplicate in the same screenshot. A rated source carries a Vorbis "RATING WMP"
// field; metadataArgs skips the rating field entirely (it has no id3 mapping), so it emits
// no clear for it either and ffmpeg's -map_metadata copies the raw byte across as a TXXX.
// writeTags then adds the POPM it is supposed to write, and mp3tag lists both under one
// name — showing 255 and 5, which is one rating printed in two scales, not two ratings.
describe('an ID3 conversion leaves exactly one WMP rating', () => {
  it('writes the rating once to an mp3, as POPM', async () => {
    const rated = join(dir, 'rated.flac')
    execFileSync(FF, [
      '-v',
      'quiet',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-metadata',
      'RATING WMP=255',
      '-y',
      rated,
    ])

    const out = join(dir, 'rating.mp3')
    await convertAudio(rated, out, 'mp3', { ...meta, rating: '5' })

    // POPM is what Traktor and every DJ tool read; the TXXX mirror is ffmpeg's leftover.
    expect(wmpRatingRows(out)).toEqual(['POPM:255'])
  })
})

// One comment, under one name. ffmpeg maps the `comment` key onto the Vorbis field
// DESCRIPTION rather than COMMENT, so a file that already carried a COMMENT from another
// tagger could in principle come out with both. It does not — ffmpeg reads the stale one
// into the same internal key our value overwrites — and this pins that, since the two
// spellings are what a DJ program matches on.
describe('a FLAC conversion leaves exactly one comment', () => {
  it('does not leave a stale comment beside the one it writes', async () => {
    const out = join(dir, 'comment.flac')
    await convertAudio(source, out, 'flac', meta)

    const names = rawVorbisFields(out).filter((n) => n === 'COMMENT' || n === 'DESCRIPTION')
    expect(names).toHaveLength(1)
  })

  it('keeps the comment readable after the conversion', async () => {
    const out = join(dir, 'comment-roundtrip.flac')
    await convertAudio(source, out, 'flac', meta)

    expect((await readMeta(out)).tags.comment).toBe('11A - Energy 7')
  })
})
