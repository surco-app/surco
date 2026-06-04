import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Id3v2FrameClassType,
  type Id3v2Tag,
  Id3v2UserTextInformationFrame,
  File as TagFile,
  TagTypes,
} from 'node-taglib-sharp'
import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../shared/types'
import { preservesCuesInPlace, writeTags } from './tags'

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

describe('writeTags', () => {
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

  it('clears a field the user emptied', () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-tags-'))
    const file = buildSeed(dir)

    writeTags(file, { ...meta, comment: '' })

    const f = TagFile.createFromPath(file)
    expect(f.tag.comment).toBeFalsy()
    f.dispose()
  })
})
