import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  ByteVector,
  Id3v2FrameClassType,
  Id3v2FrameIdentifiers,
  Id3v2PopularimeterFrame,
  Id3v2PrivateFrame,
  type Id3v2Tag,
  type Id3v2TextInformationFrame,
  Id3v2UserTextInformationFrame,
  type Mpeg4AppleTag,
  PictureType,
  StringType,
  File as TagFile,
  TagTypes,
  type XiphComment,
} from 'node-taglib-sharp'
import { describe, expect, it } from 'vitest'
import {
  starsToRating,
  starsToWmpRating,
  TRAKTOR_RATING_USER,
  WMP_RATING_USER,
} from '../shared/rating'
import type { TrackMetadata } from '../shared/types'
import { decodeBase91, encodeBase91 } from './base91'
import {
  copyCueFrames,
  preservesCuesInPlace,
  readCueTree,
  readItunesGrouping,
  readPopmRating,
  shiftFlacCues,
  writeTags,
} from './tags'
import { readTraktorMarkers } from './traktor4'
import { buildTraktorTree, readTraktorCueStart, traktorCue } from './traktor4Fixture'

const FFMPEG = ffmpegStatic as unknown as string

// Strips the GEOB cue frame from a file, to model the output of a normalizing
// ffmpeg re-encode (which drops it) before copyCueFrames puts it back.
function stripCues(file: string): void {
  const f = TagFile.createFromPath(file)
  ;(f.getTag(TagTypes.Id3v2, true) as Id3v2Tag).removeFrames(Id3v2FrameIdentifiers.GEOB)
  f.save()
  f.dispose()
}

// Injects a foreign TXXX frame the app doesn't manage, modelling the "NOTES"
// (Medieval CUE Splitter) leftover users hit — a frame clearExtras must wipe.
function addForeignFrame(file: string, description: string, value: string): void {
  const f = TagFile.createFromPath(file)
  const id3 = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
  const txxx = Id3v2UserTextInformationFrame.fromDescription(description)
  txxx.text = [value]
  id3.addFrame(txxx)
  f.save()
  f.dispose()
}

// Injects a foreign iTunes freeform ("----") atom under the standard MEAN every
// tagger uses, modelling a third-party tool's leftover (e.g. a ReplayGain scanner)
// that clearExtras/foreignRemoved must be able to reach on an m4a.
function addForeignItunesAtom(file: string, name: string, value: string): void {
  const f = TagFile.createFromPath(file)
  ;(f.tag as Mpeg4AppleTag).setItunesStrings('com.apple.iTunes', name, value)
  f.save()
  f.dispose()
}

// Reads back a TXXX frame by its description (CATALOGNUMBER, MOOD, ENERGY…).
function userText(id3: Id3v2Tag, description: string): Id3v2UserTextInformationFrame | undefined {
  return Id3v2UserTextInformationFrame.findUserTextInformationFrame(
    id3.getFramesByClassType<Id3v2UserTextInformationFrame>(
      Id3v2FrameClassType.UserTextInformationFrame,
    ),
    description,
  )
}

// How many POPM (rating) frames a file carries — writeTags writes two (Traktor + WMP).
function popmCount(file: string): number {
  const f = TagFile.createFromPath(file)
  try {
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
    return id3?.frames.filter((fr) => fr.frameId.toString() === 'POPM').length ?? 0
  } finally {
    f.dispose()
  }
}

// The byte length of each picture in a file's tag. Sizes rather than a count, so a
// replacement that left the old artwork in place is visible as the wrong bytes and
// not just the wrong number.
function m4aPictureSizes(file: string): number[] {
  const f = TagFile.createFromPath(file)
  try {
    return f.tag.pictures.map((p) => p.data.length)
  } finally {
    f.dispose()
  }
}

// The rating byte one POPM user carries, or null when that user has no frame. Which
// byte landed under which user is the part popmCount cannot see.
function popmByUser(file: string, user: string): number | null {
  const f = TagFile.createFromPath(file)
  try {
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
    if (!id3) return null
    const frames = id3.getFramesByClassType<Id3v2PopularimeterFrame>(
      Id3v2FrameClassType.PopularimeterFrame,
    )
    return Id3v2PopularimeterFrame.find(frames, user)?.rating ?? null
  } finally {
    f.dispose()
  }
}

const meta: TrackMetadata = {
  title: 'Till I Come',
  artist: 'ATB',
  album: 'Movin Melodies',
  albumArtist: 'ATB',
  year: '1999',
  genre: 'Trance',
  grouping: '',
  comment: '',
  trackNumber: '2',
  discNumber: '',
  bpm: '138',
  key: '9A',
  publisher: 'Kontor',
  catalogNumber: 'KON-123',
  remixArtist: '',
}

// Builds a tiny but valid MP3: an ID3v2.3 tag carrying a title plus a GEOB
// "TRAKTOR4" frame (exactly how Traktor stores its cue points/beatgrid),
// followed by silent MPEG-1 Layer III frames so TagLib can open it.
function buildSeed(dir: string): string {
  const syncsafe = (n: number) =>
    Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
  const frame = (id: string, data: Buffer) => {
    const head = Buffer.alloc(10)
    head.write(id, 0, 'latin1')
    head.writeUInt32BE(data.length, 4)
    return Buffer.concat([head, data])
  }
  const tit2 = frame('TIT2', Buffer.concat([Buffer.from([0]), Buffer.from('Old Title', 'latin1')]))
  const geob = frame(
    'GEOB',
    Buffer.concat([
      Buffer.from([0]),
      Buffer.from('application/octet-stream', 'latin1'),
      Buffer.from([0, 0]),
      Buffer.from('TRAKTOR4', 'latin1'),
      Buffer.from([0]),
      Buffer.from('TRAKTORCUEBLOB', 'latin1'),
    ]),
  )
  const body = Buffer.concat([tit2, geob])
  const header = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), syncsafe(body.length)])
  const mpegFrame = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413)])
  const audio = Buffer.concat(Array(20).fill(mpegFrame))
  const path = join(dir, 'seed.mp3')
  writeFileSync(path, Buffer.concat([header, body, audio]))
  return path
}

// Builds an MP3 whose grouping lives ONLY in iTunes' proprietary GRP1 frame (a raw text
// frame: [encoding byte][Latin1 text]) — the state a file re-saved by Apple Music reaches.
// GRP1 isn't a standard identifier, so it's written as raw bytes like buildSeed's own frames
// rather than through TagLib's frame API (which doesn't know GRP1).
function buildSeedWithGrp1(dir: string, grouping: string): string {
  const syncsafe = (n: number) =>
    Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
  const frame = (id: string, data: Buffer) => {
    const head = Buffer.alloc(10)
    head.write(id, 0, 'latin1')
    head.writeUInt32BE(data.length, 4)
    return Buffer.concat([head, data])
  }
  const tit2 = frame('TIT2', Buffer.concat([Buffer.from([0]), Buffer.from('Old Title', 'latin1')]))
  const grp1 = frame('GRP1', Buffer.concat([Buffer.from([0]), Buffer.from(grouping, 'latin1')]))
  const body = Buffer.concat([tit2, grp1])
  const header = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), syncsafe(body.length)])
  const mpegFrame = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413)])
  const audio = Buffer.concat(Array(20).fill(mpegFrame))
  const path = join(dir, 'grp1.mp3')
  writeFileSync(path, Buffer.concat([header, body, audio]))
  return path
}

// A minimal valid RIFF/WAVE (PCM 16-bit mono, a few silent samples): enough
// container for TagLib to open and add its "id3 " chunk to.
function buildWavSeed(dir: string): string {
  const fmt = Buffer.alloc(24)
  fmt.write('fmt ', 0, 'latin1')
  fmt.writeUInt32LE(16, 4)
  fmt.writeUInt16LE(1, 8)
  fmt.writeUInt16LE(1, 10)
  fmt.writeUInt32LE(44100, 12)
  fmt.writeUInt32LE(88200, 16)
  fmt.writeUInt16LE(2, 20)
  fmt.writeUInt16LE(16, 22)
  const data = Buffer.concat([Buffer.from('data', 'latin1'), Buffer.alloc(4 + 200)])
  data.writeUInt32LE(200, 4)
  const body = Buffer.concat([Buffer.from('WAVE', 'latin1'), fmt, data])
  const riff = Buffer.alloc(8)
  riff.write('RIFF', 0, 'latin1')
  riff.writeUInt32LE(body.length, 4)
  const path = join(dir, 'seed.wav')
  writeFileSync(path, Buffer.concat([riff, body]))
  return path
}

function buildCover(dir: string): string {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/1eQAAAAAElFTkSuQmCC',
    'base64',
  )
  const path = join(dir, 'cover.png')
  writeFileSync(path, png)
  return path
}

describe('preservesCuesInPlace', () => {
  it('keeps ID3 formats in place so Traktor cues survive', () => {
    expect(preservesCuesInPlace('.mp3')).toBe(true)
    expect(preservesCuesInPlace('.aiff')).toBe(true)
  })

  // WAV/FLAC do not round-trip the GEOB frame cleanly through TagLib, so they
  // stay on the ffmpeg path rather than risk corrupting the file.
  it('leaves WAV and FLAC to the converter', () => {
    expect(preservesCuesInPlace('.wav')).toBe(false)
    expect(preservesCuesInPlace('.flac')).toBe(false)
  })
})

// A minimal real ALAC .m4a (0.01s of silence, encoded once with ffmpeg and embedded
// as base64 like the hand-built MP3 seed above): TagLib needs a genuine MPEG-4
// container to open, and hand-assembling one is not worth the bytes.
const TINY_M4A =
  'AAAAHGZ0eXBNNEEgAAACAE00QSBpc29taXNvMgAAAAhmcmVlAAAAHW1kYXQAABAAAACgAAAPCAEAAAAAAAAA+XgAAAKrbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAAoAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAdV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAAoAAAAAAAAAAAAAAAEBAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAAKAAAAAAABAAAAAAFNbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAfQAAAAFBVxAAAAAAALWhkbHIAAAAAAAAAAHNvdW4AAAAAAAAAAAAAAABTb3VuZEhhbmRsZXIAAAAA+G1pbmYAAAAQc21oZAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAAvHN0YmwAAABYc3RzZAAAAAAAAAABAAAASGFsYWMAAAAAAAAAAQAAAAAAAAAAAAEAEAAAAAAfQAAAAAAAJGFsYWMAAAAAAAAQAAAQKAoOAQAAAAAgBAAB9AAAAB9AAAAAGHN0dHMAAAAAAAAAAQAAAAEAAABQAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAABAAAAAQAAABRzdHN6AAAAAAAAABUAAAABAAAAFHN0Y28AAAAAAAAAAQAAACwAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYyLjEyLjEwMg=='

function buildM4aSeed(dir: string): string {
  const file = join(dir, 'seed.m4a')
  writeFileSync(file, Buffer.from(TINY_M4A, 'base64'))
  return file
}

describe('writeTags', () => {
  // M4A carries iTunes atoms, not ID3: the generic pass must land the fields Music and
  // rekordbox read (title, bpm, key) without ever forcing an ID3 tag into the MP4
  // container — TagLib would happily create one, and it corrupts the file for strict
  // readers. The cover rides the covr atom via the generic pictures setter.
  it('writes iTunes atoms and cover into an m4a without creating an ID3 tag', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildM4aSeed(dir)
    const cover = join(dir, 'cover.jpg')
    // Smallest valid JPEG: TagLib only sniffs the signature to pick a mime type.
    writeFileSync(cover, Buffer.from('ffd8ffe000104a46494600ffd9', 'hex'))

    writeTags(file, { ...meta, bpm: '128', key: '8A' }, cover)

    const f = TagFile.createFromPath(file)
    expect(f.tag.title).toBe('Till I Come')
    expect(f.tag.beatsPerMinute).toBe(128)
    expect(f.tag.initialKey).toBe('8A')
    expect(f.tag.pictures).toHaveLength(1)
    expect(f.getTag(TagTypes.Id3v2, false)).toBeFalsy()
    f.dispose()
  })

  // The seed carries no artwork, so the reset that empties the covr atom is a no-op in
  // the test above and it passes with that line removed. Clearing a cover is the case
  // that needs it: writing a new picture overwrites the atom on its own, but removeCover
  // writes nothing, so without the reset the old artwork simply stays on the file.
  it('drops the m4a cover when removeCover is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildM4aSeed(dir)
    const cover = join(dir, 'cover.jpg')
    writeFileSync(cover, Buffer.from('ffd8ffe000104a46494600ffd9', 'hex'))
    writeTags(file, meta, cover)
    expect(m4aPictureSizes(file)).toHaveLength(1)

    writeTags(file, meta, undefined, true)

    expect(m4aPictureSizes(file)).toEqual([])
  })

  // "Empty every metadata field" must reach m4a's iTunes atoms too, not just the fields
  // the app manages — a foreign freeform atom a third-party tool left behind (e.g. a
  // ReplayGain scanner) used to survive clearExtras because the M4A branch had no
  // cleanup loop at all. tag.clear() wipes the whole ILST box, so it must run before
  // the generic field assignments above repopulate the managed ones.
  it('clears a foreign iTunes atom on an m4a when clearExtras is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildM4aSeed(dir)
    addForeignItunesAtom(file, 'FOREIGN_TAG', 'left by a third-party tool')

    writeTags(file, meta, undefined, false, undefined, undefined, true)

    const f = TagFile.createFromPath(file)
    expect(
      (f.tag as Mpeg4AppleTag).getFirstItunesString('com.apple.iTunes', 'FOREIGN_TAG'),
    ).toBeFalsy()
    expect(f.tag.title).toBe('Till I Come')
    f.dispose()
  })

  // The inspector's per-tag delete must also reach m4a: setItunesStrings with no data
  // clears exactly the named atom, the same MEAN/NAME route TagLib's own managed
  // freeform fields (ReplayGain, MusicBrainz ids…) already use to write them.
  it('removes a single foreign iTunes atom named in foreignRemoved on an m4a', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildM4aSeed(dir)
    addForeignItunesAtom(file, 'FOREIGN_TAG', 'left by a third-party tool')

    writeTags(file, meta, undefined, false, undefined, undefined, false, ['FOREIGN_TAG'])

    const f = TagFile.createFromPath(file)
    expect(
      (f.tag as Mpeg4AppleTag).getFirstItunesString('com.apple.iTunes', 'FOREIGN_TAG'),
    ).toBeFalsy()
    expect(f.tag.title).toBe('Till I Come')
    f.dispose()
  })

  // The conversion path writes ID3v2.3 (-id3v2_version 3); the in-place mp3/aiff edit must
  // too, or a v2.4 source would stay v2.4 and trip the CDJ/rekordbox/Serato setups that
  // mishandle it.
  it('downgrades an in-place mp3 to ID3v2.3 to match the conversion path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)
    // Make the source a v2.4 tag first, so the assertion proves a real downgrade.
    const pre = TagFile.createFromPath(file)
    ;(pre.getTag(TagTypes.Id3v2, true) as Id3v2Tag).version = 4
    pre.save()
    pre.dispose()

    writeTags(file, meta)

    const f = TagFile.createFromPath(file)
    expect((f.getTag(TagTypes.Id3v2, false) as Id3v2Tag).version).toBe(3)
    f.dispose()
  })

  // mp3tag reads a WAV's "id3 " chunk only when it holds ID3v2.3; the v2.4 tag we used
  // to write there made every field invisible to it (while TagEditor and Finder coped),
  // so users thought the conversion had produced an untagged file.
  it('writes the WAV id3 chunk as ID3v2.3, the version mp3tag reads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildWavSeed(dir)

    writeTags(file, meta)

    const f = TagFile.createFromPath(file)
    expect((f.getTag(TagTypes.Id3v2, false) as Id3v2Tag).version).toBe(3)
    expect(f.tag.title).toBe('Till I Come')
    f.dispose()
    // The raw chunk must really carry major version 3 — readers don't consult TagLib.
    const bytes = readFileSync(file)
    const chunk = bytes.indexOf(Buffer.from('id3 ', 'latin1'))
    expect(chunk).toBeGreaterThan(-1)
    expect(bytes.subarray(chunk + 8, chunk + 11).toString('latin1')).toBe('ID3')
    expect(bytes[chunk + 11]).toBe(3)
  })

  // FLAC/WAV rips commonly carry a full date ("2024-03-01") in the tag the year field
  // imports from verbatim; Number() on that is NaN, so this pass used to write year 0 —
  // an in-place edit (or the rating-triggered second pass on a re-encode) silently
  // destroyed a valid year. The leading year must survive.
  it('keeps the year when the field holds a full date', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)

    writeTags(file, { ...meta, year: '2024-03-01' })

    const f = TagFile.createFromPath(file)
    expect(f.tag.year).toBe(2024)
    f.dispose()
  })

  it("preserves Traktor's GEOB cue frame while overwriting metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)

    writeTags(file, meta)

    // The whole point: a metadata-only save must not destroy the cue blob, which
    // ffmpeg drops even on a stream copy.
    const bytes = readFileSync(file)
    expect(bytes.includes(Buffer.from('TRAKTOR4'))).toBe(true)
    expect(bytes.includes(Buffer.from('TRAKTORCUEBLOB'))).toBe(true)

    const f = TagFile.createFromPath(file)
    expect(f.tag.title).toBe('Till I Come')
    expect(f.tag.performers).toEqual(['ATB'])
    expect(f.tag.beatsPerMinute).toBe(138)
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag
    const txxx = id3.getFramesByClassType<Id3v2UserTextInformationFrame>(
      Id3v2FrameClassType.UserTextInformationFrame,
    )
    expect(
      Id3v2UserTextInformationFrame.findUserTextInformationFrame(txxx, 'CATALOGNUMBER')?.text.join(
        ';',
      ),
    ).toBe('KON-123')
    f.dispose()
  })

  // Converting a file must never wipe a rating the editor didn't surface, so an empty
  // rating is preserved by default — the deliberate asymmetry clearExtras overrides.
  it('preserves an existing rating when the field is empty and clearExtras is off', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)
    writeTags(file, { ...meta, rating: '4' })
    expect(popmCount(file)).toBe(2)

    writeTags(file, { ...meta, rating: '' })

    expect(popmCount(file)).toBe(2)
  })

  // Counting frames cannot tell the two apart, and the whole reason for writing two is
  // that they disagree: Traktor steps by 51 (4★ = 204), WMP follows its own ramp
  // (4★ = 196). Swapping the two ramps left every rating test green, so each byte is
  // read back against the user it belongs to.
  it('writes each rating ramp under its own user', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)

    writeTags(file, { ...meta, rating: '4' })

    expect(popmByUser(file, TRAKTOR_RATING_USER)).toBe(starsToRating(4))
    expect(popmByUser(file, WMP_RATING_USER)).toBe(starsToWmpRating(4))
    // Guards the assertions above against a future where both ramps return the same
    // byte, which would make swapping them undetectable again.
    expect(starsToRating(4)).not.toBe(starsToWmpRating(4))
  })

  // An empty rating under clearExtras leaves no POPM behind. Kept as a statement of the
  // user-visible rule rather than of the mechanism: writeTags already drops every frame
  // up front on clearExtras, so setRating's own POPM removal has nothing left to do by
  // the time it runs. Asserting the outcome keeps this true if either side changes.
  it('leaves no rating behind when clearExtras is set and the field is empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)
    writeTags(file, { ...meta, rating: '4' })
    expect(popmCount(file)).toBe(2)

    writeTags(file, { ...meta, rating: '' }, undefined, false, undefined, undefined, true)

    expect(popmCount(file)).toBe(0)
  })

  // "Clear metadata" means clear everything the app manages, not just the text fields:
  // the rating (which convert deliberately preserves), the embedded cover, and even
  // Traktor's cue blob — "clear everything" means everything, cues included.
  it('wipes the rating, cover and cue frame when clearExtras is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)
    const cover = buildCover(dir)
    writeTags(file, { ...meta, rating: '4' }, cover)
    expect(popmCount(file)).toBe(2)

    // The clear pass: blank meta (rating ''), no new cover, removeCover + clearExtras on.
    writeTags(file, meta, undefined, true, undefined, undefined, true)

    expect(popmCount(file)).toBe(0)
    const f = TagFile.createFromPath(file)
    const apic = (f.getTag(TagTypes.Id3v2, false) as Id3v2Tag).frames.filter(
      (fr) => fr.frameId.toString() === 'APIC',
    )
    expect(apic).toHaveLength(0)
    f.dispose()
    const bytes = readFileSync(file)
    expect(bytes.includes(Buffer.from('TRAKTOR4'))).toBe(false)
  })

  // "Empty every metadata field" must reach frames the app never wrote — a foreign
  // TXXX like "NOTES" (left by Medieval CUE Splitter) survived the managed-field
  // overwrite and read as junk users couldn't clear. clearExtras now strips every
  // frame, cues included, so the file is truly empty.
  it('strips a foreign frame the app never wrote when clearExtras is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)
    addForeignFrame(file, 'NOTES', 'Medieval CUE Splitter (www.medieval.it)')
    const seeded = TagFile.createFromPath(file)
    expect(userText(seeded.getTag(TagTypes.Id3v2, false) as Id3v2Tag, 'NOTES')).toBeDefined()
    seeded.dispose()

    writeTags(file, meta, undefined, true, undefined, undefined, true)

    const f = TagFile.createFromPath(file)
    expect(userText(f.getTag(TagTypes.Id3v2, false) as Id3v2Tag, 'NOTES')).toBeUndefined()
    f.dispose()
    expect(readFileSync(file).includes(Buffer.from('TRAKTOR4'))).toBe(false)
  })

  // A foreign frame is not metadata the user asked to change on a normal convert, so a
  // plain write (clearExtras off) must leave it alone — only "Empty every field" wipes it.
  it('keeps a foreign frame on a normal write when clearExtras is off', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)
    addForeignFrame(file, 'NOTES', 'Medieval CUE Splitter (www.medieval.it)')

    writeTags(file, meta)

    const f = TagFile.createFromPath(file)
    expect(userText(f.getTag(TagTypes.Id3v2, false) as Id3v2Tag, 'NOTES')?.text.join('')).toBe(
      'Medieval CUE Splitter (www.medieval.it)',
    )
    f.dispose()
  })

  // The inspector lets the user pick individual foreign tags to drop without wiping
  // everything else — unlike clearExtras, this must fire on a plain write too, and
  // must not touch a managed frame (the title) that happens to survive alongside it.
  it('removes a single foreign frame named in foreignRemoved and keeps managed frames', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)
    addForeignFrame(file, 'REPLAYGAIN_TRACK_GAIN', '-6.6 dB')

    writeTags(file, meta, undefined, false, undefined, undefined, false, ['REPLAYGAIN_TRACK_GAIN'])

    const f = TagFile.createFromPath(file)
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag
    expect(userText(id3, 'REPLAYGAIN_TRACK_GAIN')).toBeUndefined()
    expect(f.tag.title).toBe('Till I Come')
    f.dispose()
  })

  it('replaces the cover without duplicating it or losing the cue frame', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)
    const cover = buildCover(dir)

    writeTags(file, meta, cover)
    writeTags(file, meta, cover)

    const bytes = readFileSync(file)
    expect(bytes.includes(Buffer.from('TRAKTOR4'))).toBe(true)

    const f = TagFile.createFromPath(file)
    const apic = (f.getTag(TagTypes.Id3v2, false) as Id3v2Tag).frames.filter(
      (fr) => fr.frameId.toString() === 'APIC',
    )
    expect(apic).toHaveLength(1)
    f.dispose()
  })

  it('names the embedded cover after the album, not the temp file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)
    const cover = buildCover(dir)

    writeTags(file, meta, cover)

    const f = TagFile.createFromPath(file)
    const picture = f.tag.pictures.find((p) => p.type === PictureType.FrontCover)
    // The APIC description is what mp3tag & players show; it must not leak the
    // internal surco-cover-proc-<uuid> temp name (here the raw basename cover.png).
    expect(picture?.description).toBe('Movin Melodies.jpg')
    f.dispose()
  })

  it('falls back to a generic cover name when the album is empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)
    const cover = buildCover(dir)

    writeTags(file, { ...meta, album: '' }, cover)

    const f = TagFile.createFromPath(file)
    const picture = f.tag.pictures.find((p) => p.type === PictureType.FrontCover)
    expect(picture?.description).toBe('cover.jpg')
    f.dispose()
  })

  it('strips the cover on removeCover while keeping the cue frame', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)
    const cover = buildCover(dir)
    writeTags(file, meta, cover)

    // removeCover with no replacement clears the embedded art, but APIC and GEOB
    // share the attachment kind so the cue blob must survive the removal.
    writeTags(file, meta, undefined, true)

    const bytes = readFileSync(file)
    expect(bytes.includes(Buffer.from('TRAKTOR4'))).toBe(true)

    const f = TagFile.createFromPath(file)
    const apic = (f.getTag(TagTypes.Id3v2, false) as Id3v2Tag).frames.filter(
      (fr) => fr.frameId.toString() === 'APIC',
    )
    expect(apic).toHaveLength(0)
    expect(f.tag.title).toBe('Till I Come')
    f.dispose()
  })

  it('clears a field the user emptied', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)

    writeTags(file, { ...meta, comment: '' })

    const f = TagFile.createFromPath(file)
    expect(f.tag.comment).toBeFalsy()
    f.dispose()
  })

  it('writes composer, ISRC, mix name and original year in place', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)

    writeTags(file, {
      ...meta,
      composer: 'André Tanneberger',
      isrc: 'DEA449900124',
      mixName: 'Club Mix',
      originalYear: '1998',
    })

    const f = TagFile.createFromPath(file)
    expect(f.tag.composers).toEqual(['André Tanneberger'])
    expect(f.tag.isrc).toBe('DEA449900124')
    expect(f.tag.subtitle).toBe('Club Mix')
    // Original year has no TagLib property, so it rides a text frame: TORY on the
    // v2.3 tag this file is pinned to (the v2.4 name is TDOR).
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag
    const tory = id3.frames.find(
      (fr) => fr.frameId === Id3v2FrameIdentifiers.TDOR,
    ) as Id3v2TextInformationFrame
    expect(tory?.text).toEqual(['1998'])
    f.dispose()
    expect(readFileSync(file).includes(Buffer.from('TORY'))).toBe(true)
  })

  // Collectors tag vinyl the Discogs way: the side position ("A2") IS the track
  // number. TagLib's numeric track setter can't hold it, so writeTags must rewrite
  // the TRCK frame verbatim — matching what the ffmpeg conversion path writes.
  it('writes a vinyl-position track number verbatim into TRCK', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)

    writeTags(file, { ...meta, trackNumber: 'A2' })

    const f = TagFile.createFromPath(file)
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag
    const trck = id3.frames.find(
      (fr) => fr.frameId === Id3v2FrameIdentifiers.TRCK,
    ) as Id3v2TextInformationFrame
    expect(trck?.text).toEqual(['A2'])
    f.dispose()
  })

  it('keeps a plain numeric track number numeric', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)

    writeTags(file, { ...meta, trackNumber: '7' })

    const f = TagFile.createFromPath(file)
    expect(f.tag.track).toBe(7)
    f.dispose()
  })

  // MP4's trkn atom holds integers only, so the side letter cannot survive there;
  // the digits are the most a vinyl position can keep in an .m4a.
  it('falls back to the digits of a vinyl position for the m4a track atom', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildM4aSeed(dir)

    writeTags(file, { ...meta, trackNumber: 'A2' })

    const f = TagFile.createFromPath(file)
    expect(f.tag.track).toBe(2)
    f.dispose()
  })

  it('round-trips the compilation flag and clears it when unset', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)

    writeTags(file, { ...meta, compilation: '1' })
    let f = TagFile.createFromPath(file)
    expect(f.tag.isCompilation).toBe(true)
    f.dispose()

    writeTags(file, { ...meta, compilation: '' })
    f = TagFile.createFromPath(file)
    expect(f.tag.isCompilation).toBe(false)
    f.dispose()
  })

  it('clears the original year frame when the field is emptied', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)
    writeTags(file, { ...meta, originalYear: '1998' })

    writeTags(file, { ...meta, originalYear: '' })

    const f = TagFile.createFromPath(file)
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag
    expect(id3.frames.some((fr) => fr.frameId === Id3v2FrameIdentifiers.TDOR)).toBe(false)
    f.dispose()
  })

  // Quick Tag's two judgement fields: what the DJ hears, which no provider can supply.
  // Both ride TXXX — mood's standard TMOO frame is ID3v2.4-only and would be dropped
  // from the v2.3 tag these files are pinned to, and energy has no standard frame at all.
  it('writes mood and energy in place', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)

    writeTags(file, { ...meta, mood: 'Dark', energy: '4' })

    const f = TagFile.createFromPath(file)
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag
    expect(userText(id3, 'MOOD')?.text).toEqual(['Dark'])
    expect(userText(id3, 'ENERGY')?.text).toEqual(['4'])
    f.dispose()
  })

  // Re-judging a track has to be able to take a value back off, or a mood set by a
  // stray keypress would be unerasable from the editor.
  it('clears mood and energy when the fields are emptied', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)
    writeTags(file, { ...meta, mood: 'Dark', energy: '4' })

    writeTags(file, { ...meta, mood: '', energy: '' })

    const f = TagFile.createFromPath(file)
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag
    expect(userText(id3, 'MOOD')).toBeUndefined()
    expect(userText(id3, 'ENERGY')).toBeUndefined()
    f.dispose()
  })
})

describe('readPopmRating', () => {
  // Traktor's stars live in a POPM frame, and the bundled ffprobe does not surface POPM at
  // all — so on MP3/AIFF every rated track read back unrated, and the editor showed no
  // stars for a file Traktor shows as five. Reading the frame directly is the only way
  // those ratings reach the editor.
  it('reads a Traktor five-star POPM the probe cannot see', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-popm-'))
    const file = buildSeed(dir)
    writeTags(file, { ...meta, rating: '5' })
    expect(popmByUser(file, TRAKTOR_RATING_USER)).toBe(255)
    expect(readPopmRating(file)).toBe('5')
  })

  // Traktor's byte is the authority: a file rated in both Traktor and WMP carries two POPM
  // frames whose bytes disagree by design (204 vs 196 for four stars), and picking whichever
  // came first would make the star count depend on frame order.
  it('prefers the Traktor frame over a WMP frame that lands first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-popm-user-'))
    const file = buildSeed(dir)
    // The WMP frame is added FIRST and given a byte that reads as a different star count
    // (51 = one star on Traktor's linear scale) so that simply taking whichever POPM comes
    // first would answer '1'. Only reading Traktor's own user gives the four stars the DJ set.
    const seeded = TagFile.createFromPath(file)
    const id3 = seeded.getTag(TagTypes.Id3v2, true) as Id3v2Tag
    const wmp = Id3v2PopularimeterFrame.fromUser(WMP_RATING_USER)
    wmp.rating = 51
    id3.addFrame(wmp)
    const traktor = Id3v2PopularimeterFrame.fromUser(TRAKTOR_RATING_USER)
    traktor.rating = starsToRating(4)
    id3.addFrame(traktor)
    seeded.save()
    seeded.dispose()

    expect(popmByUser(file, WMP_RATING_USER)).toBe(51)
    expect(popmByUser(file, TRAKTOR_RATING_USER)).toBe(204)
    expect(readPopmRating(file)).toBe('4')
  })

  it('returns empty for an unrated file rather than inventing a zero', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-popm-none-'))
    const file = buildSeed(dir)
    writeTags(file, { ...meta, rating: '' })
    expect(readPopmRating(file)).toBe('')
  })
})

describe('copyCueFrames', () => {
  // Normalizing re-encodes the audio (ffmpeg drops the GEOB), but a constant gain
  // never moves the cues in time — so re-injecting the source's frame restores them
  // exactly. This is what keeps Traktor cues through a normalizing convert.
  it('re-injects the source GEOB cue frame into an output that lost it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const source = buildSeed(dir)
    const out = join(dir, 'normalized.mp3')
    writeFileSync(out, readFileSync(source))
    stripCues(out)
    expect(readFileSync(out).includes(Buffer.from('TRAKTORCUEBLOB'))).toBe(false)

    copyCueFrames(source, out)

    const bytes = readFileSync(out)
    expect(bytes.includes(Buffer.from('TRAKTOR4'))).toBe(true)
    expect(bytes.includes(Buffer.from('TRAKTORCUEBLOB'))).toBe(true)
  })

  // Builds an MP3 whose Traktor data lives where real Traktor puts it: an ID3
  // PRIV frame owned "TRAKTOR4" carrying the binary cue tree.
  function buildPrivSeed(dir: string, tree: Uint8Array): string {
    const syncsafe = (n: number) =>
      Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
    const frame = (id: string, data: Buffer) => {
      const head = Buffer.alloc(10)
      head.write(id, 0, 'latin1')
      head.writeUInt32BE(data.length, 4)
      return Buffer.concat([head, data])
    }
    const priv = frame(
      'PRIV',
      Buffer.concat([Buffer.from('TRAKTOR4', 'latin1'), Buffer.from([0]), Buffer.from(tree)]),
    )
    const body = priv
    const header = Buffer.concat([
      Buffer.from('ID3'),
      Buffer.from([3, 0, 0]),
      syncsafe(body.length),
    ])
    const mpegFrame = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413)])
    const audio = Buffer.concat(Array(20).fill(mpegFrame))
    const path = join(dir, 'priv-seed.mp3')
    writeFileSync(path, Buffer.concat([header, body, audio]))
    return path
  }

  function readPrivTree(file: string): Uint8Array | null {
    const bytes = readFileSync(file)
    const owner = Buffer.from('TRAKTOR4\0', 'latin1')
    const at = bytes.indexOf(owner)
    if (at === -1) return null
    const tree = bytes.subarray(at + owner.length)
    const len = tree.readUInt32LE(4)
    return new Uint8Array(tree.subarray(0, 12 + len))
  }

  // The PRIV frame is how real Traktor-written MP3s carry their cues; before this
  // path existed the copy only knew GEOB, so an MP3 re-encode silently lost them.
  it('carries the Traktor PRIV frame over verbatim without a trim', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const tree = buildTraktorTree([traktorCue('Drop', 0, 61234.5, 1)])
    const source = buildPrivSeed(dir, tree)
    const out = join(dir, 'normalized.mp3')
    writeFileSync(out, readFileSync(buildSeed(dir)))
    stripCues(out)

    copyCueFrames(source, out)

    const carried = readPrivTree(out)
    expect(carried).not.toBeNull()
    expect(Buffer.from(carried as Uint8Array).equals(Buffer.from(tree))).toBe(true)
  })

  // The cue carry-over removes the destination's Traktor PRIV before writing the new
  // one, and that removal is filtered by owner on purpose: PRIV is a shared frame id,
  // so every other tool's private data (Serato, MusicBrainz, a store's purchase token)
  // lives under its own owner in a frame of the same name. Widening the filter to all
  // PRIV frames left every test green while irreversibly dropping that data on each
  // conversion — nothing was reading back what the destination kept.
  it("leaves another vendor's PRIV frame on the destination", () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const tree = buildTraktorTree([traktorCue('Drop', 0, 61234.5, 1)])
    const source = buildPrivSeed(dir, tree)
    const out = join(dir, 'with-foreign-priv.mp3')
    writeFileSync(out, readFileSync(buildSeed(dir)))
    stripCues(out)

    const foreign = TagFile.createFromPath(out)
    const foreignFrame = Id3v2PrivateFrame.fromOwner('Serato Markers2')
    foreignFrame.privateData = ByteVector.fromString('serato payload', StringType.Latin1)
    ;(foreign.getTag(TagTypes.Id3v2, true) as Id3v2Tag).addFrame(foreignFrame)
    foreign.save()
    foreign.dispose()

    copyCueFrames(source, out)

    const f = TagFile.createFromPath(out)
    try {
      const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag
      const privs = id3.frames.filter(
        (fr): fr is Id3v2PrivateFrame => fr instanceof Id3v2PrivateFrame,
      )
      // Traktor's own PRIV still lands — the carry-over has to have run for the
      // survival of the foreign one to mean anything.
      expect(privs.map((fr) => fr.owner).sort()).toEqual(['Serato Markers2', 'TRAKTOR4'])
      const kept = privs.find((fr) => fr.owner === 'Serato Markers2')
      expect(kept?.privateData.toString(StringType.Latin1)).toBe('serato payload')
    } finally {
      f.dispose()
    }
  })

  // djotas's report: after a trim the audio moved under the stored cues. The copy
  // must re-anchor every position (and the checksum, or Traktor ignores the frame).
  it('re-anchors the Traktor cues by the trim and clamps into-the-cut positions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const tree = buildTraktorTree([
      traktorCue('AutoGrid', 4, 65.61, 0),
      traktorCue('Drop', 0, 61234.5, 1),
    ])
    const source = buildPrivSeed(dir, tree)
    const out = join(dir, 'trimmed.mp3')
    writeFileSync(out, readFileSync(buildSeed(dir)))
    stripCues(out)

    copyCueFrames(source, out, { shiftMs: 1300, bpm: 143.78 })

    const carried = readPrivTree(out)
    expect(carried).not.toBeNull()
    // The hotcue moves by the raw cut; the grid marker keeps its phase instead
    // (65.61 - 1300 folded back into the 417.30 ms beat), so Traktor's ruler
    // still lands on the same beats it described before the trim.
    expect(readTraktorCueStart(carried as Uint8Array, 0)).toBeCloseTo(17.52, 1)
    expect(readTraktorCueStart(carried as Uint8Array, 1)).toBeCloseTo(59934.5)
  })

  // A blob we can't re-anchor (unknown variant, corrupt) must be dropped, never
  // carried pointing at the wrong beats — and the opaque GEOB blobs join it when a
  // trim moved the audio, for the same reason.
  it('drops un-anchorable frames when a trim moved the audio', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const tree = buildTraktorTree([traktorCue('Drop', 0, 61234.5, 1)])
    tree[tree.length - 6] ^= 0xff // break the checksum inside the summed span
    const source = buildPrivSeed(dir, tree)
    const out = join(dir, 'trimmed.mp3')
    writeFileSync(out, readFileSync(buildSeed(dir)))
    stripCues(out)

    copyCueFrames(source, out, { shiftMs: 1300 })

    expect(readPrivTree(out)).toBeNull()
    expect(readFileSync(out).includes(Buffer.from('TRAKTORCUEBLOB'))).toBe(false)
  })

  it('leaves the output untouched when the source carries no cue frame', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const source = buildSeed(dir)
    stripCues(source)
    const out = join(dir, 'normalized.mp3')
    writeFileSync(out, readFileSync(source))

    expect(() => copyCueFrames(source, out)).not.toThrow()
    expect(readFileSync(out).includes(Buffer.from('TRAKTORCUEBLOB'))).toBe(false)
  })

  // A file re-saved by Apple Music keeps its grouping only in iTunes' GRP1 frame, which
  // ffprobe/ffmpeg don't surface — so readMeta reads it back through readItunesGrouping.
  it('reads the grouping from the iTunes GRP1 frame', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeedWithGrp1(dir, 'Bases, Cantaditas')
    expect(readItunesGrouping(file)).toBe('Bases, Cantaditas')
  })

  it('returns empty when there is no GRP1 frame', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)
    expect(readItunesGrouping(file)).toBe('')
  })
})

describe('shiftFlacCues', () => {
  // FLAC carries the same Traktor tree as MP3's PRIV frame, armored into a
  // TRAKTOR4 Vorbis comment because comments are text. ffmpeg copies that comment
  // through a re-encode untouched, so after a trim it holds positions measured
  // from a start the file no longer has — the cues every FLAC user sees sitting
  // late. Re-anchoring means decode, shift, re-encode, in place.
  function flacWithCues(dir: string, tree: Uint8Array): string {
    const file = join(dir, 'cued.flac')
    execFileSync(FFMPEG, [
      '-v',
      'quiet',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=2',
      '-metadata',
      `TRAKTOR4=${encodeBase91(tree)}`,
      '-y',
      file,
    ])
    return file
  }

  function readFlacTree(file: string): Uint8Array | null {
    const f = TagFile.createFromPath(file)
    try {
      const xiph = f.getTag(TagTypes.Xiph, false) as XiphComment | null
      const armored = xiph?.getField('TRAKTOR4')?.[0]
      return armored ? decodeBase91(armored) : null
    } finally {
      f.dispose()
    }
  }

  it('re-anchors the cues stored in the FLAC comment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-flac-'))
    const file = flacWithCues(
      dir,
      buildTraktorTree([traktorCue('AutoGrid', 4, 143.38, 0), traktorCue('Drop', 0, 79672.64, 1)]),
    )

    shiftFlacCues(file, { shiftMs: 1300, bpm: 138.3 })

    const tree = readFlacTree(file)
    expect(tree).not.toBeNull()
    expect(readTraktorCueStart(tree as Uint8Array, 1)).toBeCloseTo(78372.64)
  })

  // Without a trim nothing moved under the cues, so the comment must be left
  // exactly as it was rather than rewritten for no reason.
  it('leaves the comment untouched when there is no shift', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-flac-'))
    const tree = buildTraktorTree([traktorCue('Drop', 0, 79672.64, 1)])
    const file = flacWithCues(dir, tree)

    shiftFlacCues(file, undefined)

    expect(readTraktorCueStart(readFlacTree(file) as Uint8Array, 0)).toBeCloseTo(79672.64)
  })

  // The parser's existing stance: a blob it can't re-anchor is dropped, never
  // carried pointing at the wrong beats. On FLAC that means clearing the comment
  // so Traktor re-analyzes instead of trusting stale positions.
  it('drops a comment it cannot re-anchor', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-flac-'))
    const tree = buildTraktorTree([traktorCue('Drop', 0, 79672.64, 1)])
    tree[tree.length - 6] ^= 0xff // break the checksum inside the summed span
    const file = flacWithCues(dir, tree)

    shiftFlacCues(file, { shiftMs: 1300, bpm: 138.3 })

    expect(readFlacTree(file)).toBeNull()
  })

  it('does nothing to a FLAC that carries no cue comment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-flac-'))
    const file = join(dir, 'plain.flac')
    execFileSync(FFMPEG, [
      '-v',
      'quiet',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-y',
      file,
    ])

    expect(() => shiftFlacCues(file, { shiftMs: 1300, bpm: 138.3 })).not.toThrow()
    expect(readFlacTree(file)).toBeNull()
  })
})

describe('readCueTree', () => {
  // Mirrors buildPrivSeed in the copyCueFrames suite: an ID3v2.3 MP3 whose cues
  // live in a PRIV frame owned "TRAKTOR4", exactly where real Traktor writes them.
  function seedPrivMp3(): string {
    const dir = mkdtempSync(join(tmpdir(), 'surco-readcuetree-'))
    const tree = buildTraktorTree([traktorCue('Drop', 0, 61234.5, 1)])
    const syncsafe = (n: number) =>
      Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
    const frame = (id: string, data: Buffer) => {
      const head = Buffer.alloc(10)
      head.write(id, 0, 'latin1')
      head.writeUInt32BE(data.length, 4)
      return Buffer.concat([head, data])
    }
    const body = frame(
      'PRIV',
      Buffer.concat([Buffer.from('TRAKTOR4', 'latin1'), Buffer.from([0]), Buffer.from(tree)]),
    )
    const header = Buffer.concat([
      Buffer.from('ID3'),
      Buffer.from([3, 0, 0]),
      syncsafe(body.length),
    ])
    const mpegFrame = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413)])
    const audio = Buffer.concat(Array(20).fill(mpegFrame))
    const path = join(dir, 'priv-seed.mp3')
    writeFileSync(path, Buffer.concat([header, body, audio]))
    return path
  }

  // Mirrors flacWithCues in the shiftFlacCues suite: the cue tree armored into a
  // TRAKTOR4 Vorbis comment, the FLAC counterpart of the PRIV frame above.
  function seedFlacWithArmoredCues(): string {
    const dir = mkdtempSync(join(tmpdir(), 'surco-readcuetree-'))
    const tree = buildTraktorTree([traktorCue('Drop', 0, 79672.64, 1)])
    const file = join(dir, 'cued.flac')
    execFileSync(FFMPEG, [
      '-v',
      'quiet',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=2',
      '-metadata',
      `TRAKTOR4=${encodeBase91(tree)}`,
      '-y',
      file,
    ])
    return file
  }

  // An MP3 with an ID3 tag but no PRIV/GEOB "TRAKTOR4" frame at all.
  function seedPlainMp3(): string {
    const dir = mkdtempSync(join(tmpdir(), 'surco-readcuetree-'))
    const syncsafe = (n: number) =>
      Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
    const frame = (id: string, data: Buffer) => {
      const head = Buffer.alloc(10)
      head.write(id, 0, 'latin1')
      head.writeUInt32BE(data.length, 4)
      return Buffer.concat([head, data])
    }
    const body = frame('TIT2', Buffer.concat([Buffer.from([0]), Buffer.from('No Cues', 'latin1')]))
    const header = Buffer.concat([
      Buffer.from('ID3'),
      Buffer.from([3, 0, 0]),
      syncsafe(body.length),
    ])
    const mpegFrame = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413)])
    const audio = Buffer.concat(Array(20).fill(mpegFrame))
    const path = join(dir, 'plain.mp3')
    writeFileSync(path, Buffer.concat([header, body, audio]))
    return path
  }

  // The NML needs the cues of the file YA convertido, not the source's: they are
  // the ones the conversion re-anchored. One reader for both families, because the
  // caller (the batch accumulator) shouldn't need to know how each format stores them.
  it('reads the cue tree back out of an ID3 file', () => {
    const file = seedPrivMp3()

    const tree = readCueTree(file)

    expect(tree).not.toBeNull()
    expect(readTraktorMarkers(tree as Uint8Array)).toHaveLength(1)
  })

  it('reads the cue tree back out of a FLAC file', () => {
    const file = seedFlacWithArmoredCues()

    const tree = readCueTree(file)

    expect(tree).not.toBeNull()
    expect(readTraktorMarkers(tree as Uint8Array)).toHaveLength(1)
  })

  // No cues is not an error: the track simply has nothing to carry into the NML.
  it('returns null for a file with no Traktor cues', () => {
    expect(readCueTree(seedPlainMp3())).toBeNull()
  })
})

// Files that passed through Mixed In Key or Serato carry THEIR objects in GEOB frames too
// — GEOB is a generic ID3 container, and each object is identified by its description
// ("Key", "Energy", "BeatGrid", "Serato Overview"). The cue copy used to take the first
// GEOB in the file whatever it was, so a track tagged by Mixed In Key shipped its 69-byte
// key string into the FLAC's Traktor cue field. djotas saw it as "different results per
// file": what got copied depended on which tool touched the file and in what order.
describe('cue source selection', () => {
  function buildMultiGeobMp3(dir: string, descriptions: string[]): string {
    const syncsafe = (n: number) =>
      Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
    const frame = (id: string, data: Buffer) => {
      const head = Buffer.alloc(10)
      head.write(id, 0, 'latin1')
      head.writeUInt32BE(data.length, 4)
      return Buffer.concat([head, data])
    }
    const geob = (description: string, payload: string) =>
      frame(
        'GEOB',
        Buffer.concat([
          Buffer.from([0]),
          Buffer.from('application/json', 'latin1'),
          Buffer.from([0, 0]),
          Buffer.from(description, 'latin1'),
          Buffer.from([0]),
          Buffer.from(payload, 'latin1'),
        ]),
      )
    const body = Buffer.concat(descriptions.map((d) => geob(d, `PAYLOAD-${d}`)))
    const header = Buffer.concat([
      Buffer.from('ID3'),
      Buffer.from([3, 0, 0]),
      syncsafe(body.length),
    ])
    const mpegFrame = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413)])
    const audio = Buffer.concat(Array(20).fill(mpegFrame))
    const path = join(dir, `multi-${descriptions.join('-')}.mp3`)
    writeFileSync(path, Buffer.concat([header, body, audio]))
    return path
  }

  it('ignores GEOB objects that belong to other tools', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-cue-src-'))
    // Exactly the shape of djotas' files: Mixed In Key's Key and Energy first.
    const src = buildMultiGeobMp3(dir, ['Key', 'Energy'])
    expect(readCueTree(src)).toBeNull()
  })

  it("still finds Traktor's own GEOB when it is not the first one", () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-cue-src-'))
    const src = buildMultiGeobMp3(dir, ['Key', 'Energy', 'TRAKTOR4'])
    const tree = readCueTree(src)
    expect(tree).not.toBeNull()
    expect(Buffer.from(tree as Uint8Array).toString('latin1')).toContain('PAYLOAD-TRAKTOR4')
  })
})

// The end of djotas' road: an MP3 that only ever saw Mixed In Key still reaches a FLAC
// with its cues, translated into the tree Traktor reads. Before this they arrived as
// nothing at best, and as Mixed In Key's 69-byte "Key" string at worst.
describe('Mixed In Key cue carry-over', () => {
  function buildMikMp3(dir: string): string {
    const cues = JSON.stringify({
      algorithm: 14,
      cues: [
        { name: 'Cue 1', time: 513.1115785817811 },
        { name: 'Cue 2', time: 65089.103025421 },
      ],
      source: 'mixedinkey',
    })
    const syncsafe = (n: number) =>
      Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
    const frame = (id: string, data: Buffer) => {
      const head = Buffer.alloc(10)
      head.write(id, 0, 'latin1')
      head.writeUInt32BE(data.length, 4)
      return Buffer.concat([head, data])
    }
    const geob = (description: string, payload: Buffer) =>
      frame(
        'GEOB',
        Buffer.concat([
          Buffer.from([0]),
          Buffer.from('application/json', 'latin1'),
          Buffer.from([0, 0]),
          Buffer.from(description, 'latin1'),
          Buffer.from([0]),
          payload,
        ]),
      )
    // Mixed In Key's own order: Key and Energy first, cues last.
    const body = Buffer.concat([
      geob('Key', Buffer.from('eyJrZXkiOiIxMUEifQ==', 'latin1')),
      geob('Energy', Buffer.from('eyJlbmVyZ3kiOjZ9', 'latin1')),
      geob('CuePoints', Buffer.from(Buffer.from(cues, 'utf8').toString('base64'), 'latin1')),
    ])
    const header = Buffer.concat([
      Buffer.from('ID3'),
      Buffer.from([3, 0, 0]),
      syncsafe(body.length),
    ])
    const mpegFrame = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413)])
    const audio = Buffer.concat(Array(20).fill(mpegFrame))
    const path = join(dir, 'mik.mp3')
    writeFileSync(path, Buffer.concat([header, body, audio]))
    return path
  }

  it('translates Mixed In Key cues into a tree Traktor can read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-mik-'))
    const src = buildMikMp3(dir)

    const tree = readCueTree(src)
    expect(tree).not.toBeNull()

    const markers = readTraktorMarkers(tree as Uint8Array)
    expect(markers.map((m) => m.name)).toEqual(['Cue 1', 'Cue 2'])
    expect(markers.map((m) => Math.round(m.startMs))).toEqual([513, 65089])
  })
})
