import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { type Id3v2Tag, File as TagFile, TagTypes, type XiphComment } from 'node-taglib-sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import type { TrackMetadata } from '../shared/types'
import { decodeBase91, encodeBase91 } from './base91'
import { convertAudio } from './ffmpeg'
import { buildTraktorTree, readTraktorCueStart, traktorCue } from './traktor4Fixture'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-cues-'))
const src = join(dir, 'in.aiff')

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

// A raw ID3v2.3 tag carrying a single GEOB "TRAKTOR4" frame — exactly how Traktor
// stores its cue points/beatgrid on disk. Written as raw bytes (not via TagLib's
// UnknownFrame API, whose frames don't round-trip cleanly) so copyCueFrames clones
// the real on-disk shape a converted file would actually carry.
function id3WithCue(): Buffer {
  const frame = (id: string, data: Buffer) => {
    const head = Buffer.alloc(10)
    head.write(id, 0, 'latin1')
    head.writeUInt32BE(data.length, 4)
    return Buffer.concat([head, data])
  }
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
  const syncsafe = (n: number) =>
    Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), syncsafe(geob.length), geob])
}

// Appends an AIFF 'ID3 ' chunk holding the raw cue tag, fixing up the FORM size.
function injectAiffCue(path: string): void {
  const base = readFileSync(path)
  const id3 = id3WithCue()
  const body = id3.length % 2 ? Buffer.concat([id3, Buffer.from([0])]) : id3
  const size = Buffer.alloc(4)
  size.writeUInt32BE(id3.length)
  const out = Buffer.concat([base, Buffer.from('ID3 '), size, body])
  out.writeUInt32BE(out.length - 8, 4)
  writeFileSync(path, out)
}

function hasCue(file: string): boolean {
  const f = TagFile.createFromPath(file)
  try {
    const tag = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
    return (tag?.frames ?? []).some((fr) => fr.frameId.toString() === 'GEOB')
  } finally {
    f.dispose()
  }
}

function hasPopm(file: string): boolean {
  const f = TagFile.createFromPath(file)
  try {
    const tag = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
    return (tag?.frames ?? []).some((fr) => fr.frameId.toString() === 'POPM')
  } finally {
    f.dispose()
  }
}

beforeAll(() => {
  // A real, decodable integer-PCM AIFF so convertAudio's probe/re-encode runs for
  // real, with a raw Traktor GEOB cue frame written into its ID3 chunk.
  execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', src])
  injectAiffCue(src)
})

describe('convertAudio cue preservation', () => {
  // The reported bug: converting a cued track to another format is a plain
  // re-encode (no loudness pass), and ffmpeg rebuilds the tag dropping Traktor's
  // GEOB cue/beatgrid frame. The frame was only restored on the normalize path,
  // so a straight format change silently lost every cue.
  it('keeps the source GEOB cue frame when re-encoding to an ID3 target without normalizing', async () => {
    expect(hasCue(src)).toBe(true)
    const out = join(dir, 'out.mp3')
    await convertAudio(src, out, 'mp3', meta)
    expect(hasCue(out)).toBe(true)
  })

  // A rated track exercises the encode path's TagLib pass (POPM has no ffmpeg
  // flag) on top of the cue carry-over — both must land in the output, whatever
  // shape the tag passes take.
  it('keeps both the cue frame and the rating when re-encoding a rated track', async () => {
    const out = join(dir, 'out-rated.mp3')
    await convertAudio(src, out, 'mp3', { ...meta, rating: '4' })
    expect(hasCue(out)).toBe(true)
    const f = TagFile.createFromPath(out)
    try {
      const tag = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
      const popm = (tag?.frames ?? []).filter((fr) => fr.frameId.toString() === 'POPM')
      expect(popm.length).toBeGreaterThan(0)
    } finally {
      f.dispose()
    }
  })

  // "Clear metadata" then convert: clearExtras forces the empty rating to wipe the
  // POPM the source carried, and now the Traktor cue blob too — "clear everything"
  // means everything, cues included.
  it('wipes the rating and the cue frame on a cleared convert', async () => {
    // A fresh cued source in its own dir: TagLib holds files open across a shared
    // temp dir, so this test mints its own to stay independent of the others.
    const own = mkdtempSync(join(tmpdir(), 'surco-clear-'))
    const cued = join(own, 'in.aiff')
    execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', cued])
    injectAiffCue(cued)

    // First give the source a real rating in an mp3, then clear-convert it.
    const rated = join(own, 'rated-src.mp3')
    await convertAudio(cued, rated, 'mp3', { ...meta, rating: '4' })
    expect(hasPopm(rated)).toBe(true)

    const out = join(own, 'out-cleared.mp3')
    await convertAudio(
      rated,
      out,
      'mp3',
      { ...meta, rating: '' },
      undefined, // coverPath
      undefined, // normalize
      true, // removeCover
      undefined, // quality
      undefined, // forceReencode
      undefined, // onChild
      undefined, // onTmp
      undefined, // finderCovers
      undefined, // declick
      undefined, // trim
      true, // clearExtras
    )

    expect(hasCue(out)).toBe(false)
    expect(hasPopm(out)).toBe(false)
  })

  // djotas's FLAC library, end to end: the TRAKTOR4 comment survives ffmpeg on its
  // own, so before this the cues came out the far side still measured from the
  // pre-trim start — every marker sitting late by the whole cut. Now the same
  // parser MP3 uses re-anchors them through the armoring, hotcues by the cut and
  // the grid marker by its phase.
  it('re-anchors the FLAC cue comment through a trimming convert', async () => {
    const own = mkdtempSync(join(tmpdir(), 'surco-flacconv-'))
    const cued = join(own, 'in.flac')
    const tree = buildTraktorTree([
      traktorCue('AutoGrid', 4, 143.38, 0),
      traktorCue('Drop', 0, 79672.64, 1),
    ])
    execFileSync(FF, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=4',
      '-metadata',
      `TRAKTOR4=${encodeBase91(tree)}`,
      cued,
    ])

    const out = join(own, 'out.flac')
    await convertAudio(
      cued,
      out,
      'flac',
      { ...meta, bpm: '138.30' },
      undefined, // coverPath
      undefined, // normalize
      false, // removeCover
      undefined, // quality
      undefined, // forceReencode
      undefined, // onChild
      undefined, // onTmp
      undefined, // finderCovers
      undefined, // declick
      { startSec: 1.3 }, // trim
    )

    const f = TagFile.createFromPath(out)
    const armored = (f.getTag(TagTypes.Xiph, false) as XiphComment | null)?.getField(
      'TRAKTOR4',
    )?.[0]
    f.dispose()
    expect(armored).toBeDefined()
    expect(readTraktorCueStart(decodeBase91(armored as string), 1)).toBeCloseTo(78372.64)
  })

  // The library move users actually make: an AIFF crate with cues converted to FLAC. The
  // output extension picks the cue path, so .flac routes to shiftFlacCues — which only
  // re-anchors a TRAKTOR4 comment that rode the encode by itself. Coming from AIFF the cues
  // were in an ID3 GEOB that ffmpeg does not translate into a Vorbis comment, so there is
  // nothing to shift and they are simply gone. Crossing tag families has to carry them over.
  it('carries the cues over when converting a cued AIFF to FLAC', async () => {
    const own = mkdtempSync(join(tmpdir(), 'surco-aiff2flac-'))
    const cued = join(own, 'in.aiff')
    execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', cued])
    injectAiffCue(cued)
    expect(hasCue(cued)).toBe(true)

    const out = join(own, 'out.flac')
    await convertAudio(cued, out, 'flac', meta)

    const f = TagFile.createFromPath(out)
    const armored = (f.getTag(TagTypes.Xiph, false) as XiphComment | null)?.getField(
      'TRAKTOR4',
    )?.[0]
    f.dispose()
    expect(armored).toBeDefined()
  })

  // The re-encode path folds the cue carry-over into the same writeTags call as the
  // rating (cueSource: input, see ffmpeg.ts), so a clearExtras re-encode must not let
  // that carry-over reinject the very cues clearExtras just wiped — converting a cued
  // AIFF to a different ID3 format (forcing the encode path, not the in-place stream
  // copy) with clearExtras must drop the cue for good.
  it('does not reinject the source cue frame on a cleared re-encode to a different format', async () => {
    expect(hasCue(src)).toBe(true)
    const out = join(dir, 'out-cleared-reencode.mp3')
    await convertAudio(
      src,
      out,
      'mp3',
      meta,
      undefined, // coverPath
      undefined, // normalize
      false, // removeCover
      undefined, // quality
      undefined, // forceReencode
      undefined, // onChild
      undefined, // onTmp
      undefined, // finderCovers
      undefined, // declick
      undefined, // trim
      true, // clearExtras
    )
    expect(hasCue(out)).toBe(false)
  })
})
