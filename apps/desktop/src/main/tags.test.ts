import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Id3v2FrameClassType,
  Id3v2FrameIdentifiers,
  type Id3v2Tag,
  type Id3v2TextInformationFrame,
  Id3v2UserTextInformationFrame,
  PictureType,
  File as TagFile,
  TagTypes,
} from 'node-taglib-sharp'
import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../shared/types'
import { copyCueFrames, preservesCuesInPlace, writeTags } from './tags'
import { buildTraktorTree, readTraktorCueStart, traktorCue } from './traktor4Fixture'

// Strips the GEOB cue frame from a file, to model the output of a normalizing
// ffmpeg re-encode (which drops it) before copyCueFrames puts it back.
function stripCues(file: string): void {
  const f = TagFile.createFromPath(file)
  ;(f.getTag(TagTypes.Id3v2, true) as Id3v2Tag).removeFrames(Id3v2FrameIdentifiers.GEOB)
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
const TINY_M4A = 'AAAAHGZ0eXBNNEEgAAACAE00QSBpc29taXNvMgAAAAhmcmVlAAAAHW1kYXQAABAAAACgAAAPCAEAAAAAAAAA+XgAAAKrbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAAoAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAdV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAAoAAAAAAAAAAAAAAAEBAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAAKAAAAAAABAAAAAAFNbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAfQAAAAFBVxAAAAAAALWhkbHIAAAAAAAAAAHNvdW4AAAAAAAAAAAAAAABTb3VuZEhhbmRsZXIAAAAA+G1pbmYAAAAQc21oZAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAAvHN0YmwAAABYc3RzZAAAAAAAAAABAAAASGFsYWMAAAAAAAAAAQAAAAAAAAAAAAEAEAAAAAAfQAAAAAAAJGFsYWMAAAAAAAAQAAAQKAoOAQAAAAAgBAAB9AAAAB9AAAAAGHN0dHMAAAAAAAAAAQAAAAEAAABQAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAABAAAAAQAAABRzdHN6AAAAAAAAABUAAAABAAAAFHN0Y28AAAAAAAAAAQAAACwAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYyLjEyLjEwMg=='

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

  // "Clear metadata" means clear everything the app manages, not just the text fields:
  // the rating (which convert deliberately preserves) and the embedded cover must go
  // too. Traktor's cue blob is not a managed field, so it must still survive.
  it('wipes the rating and cover but keeps the cue frame when clearExtras is set', () => {
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
    expect(bytes.includes(Buffer.from('TRAKTOR4'))).toBe(true)
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
    const header = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), syncsafe(body.length)])
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

  // djotas's report: after a trim the audio moved under the stored cues. The copy
  // must re-anchor every position (and the checksum, or Traktor ignores the frame).
  it('re-anchors the Traktor cues by the trim and clamps into-the-cut positions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const tree = buildTraktorTree([traktorCue('AutoGrid', 4, 65.61, 0), traktorCue('Drop', 0, 61234.5, 1)])
    const source = buildPrivSeed(dir, tree)
    const out = join(dir, 'trimmed.mp3')
    writeFileSync(out, readFileSync(buildSeed(dir)))
    stripCues(out)

    copyCueFrames(source, out, { shiftMs: 1300 })

    const carried = readPrivTree(out)
    expect(carried).not.toBeNull()
    expect(readTraktorCueStart(carried as Uint8Array, 0)).toBeCloseTo(0)
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
})
