import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Id3v2FrameClassType,
  Id3v2FrameIdentifiers,
  type Id3v2Tag,
  type Id3v2TextInformationFrame,
  Id3v2UserTextInformationFrame,
  File as TagFile,
  TagTypes,
} from 'node-taglib-sharp'
import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../shared/types'
import { copyCueFrames, preservesCuesInPlace, writeTags } from './tags'

// Strips the GEOB cue frame from a file, to model the output of a normalizing
// ffmpeg re-encode (which drops it) before copyCueFrames puts it back.
function stripCues(file: string): void {
  const f = TagFile.createFromPath(file)
  ;(f.getTag(TagTypes.Id3v2, true) as Id3v2Tag).removeFrames(Id3v2FrameIdentifiers.GEOB)
  f.save()
  f.dispose()
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
