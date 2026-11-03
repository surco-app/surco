import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  ByteVector,
  Id3v2AttachmentFrame,
  type Id3v2Tag,
  type Mpeg4AppleTag,
  Picture,
  PictureType,
  StringType,
  File as TagFile,
  TagTypes,
  type XiphComment,
} from 'node-taglib-sharp'
import { describe, expect, it } from 'vitest'
import {
  SERATO_AIFF,
  SERATO_FLAC,
  SERATO_M4A,
  SERATO_MP3,
  SERATO_WAV,
} from '../shared/seratoMarkersFixture'
import { readSeratoMarkers } from './seratoTags'

const FFMPEG = ffmpegStatic as unknown as string

function audioFile(ext: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'surco-serato-tags-')), `track.${ext}`)
  execFileSync(FFMPEG, [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=44100',
    '-t',
    '0.3',
    file,
    '-y',
  ])
  return file
}

function withTag(file: string, write: (f: TagFile) => void): string {
  const f = TagFile.createFromPath(file)
  try {
    write(f)
    f.save()
  } finally {
    f.dispose()
  }
  return file
}

function addGeob(f: TagFile, description: string, base64: string): void {
  const picture = Picture.fromFullData(
    ByteVector.fromByteArray(Buffer.from(base64, 'base64')),
    PictureType.NotAPicture,
    'application/octet-stream',
    description,
  )
  picture.filename = ''
  const frame = Id3v2AttachmentFrame.fromPicture(picture)
  frame.textEncoding = StringType.Latin1
  ;(f.getTag(TagTypes.Id3v2, true) as Id3v2Tag).addFrame(frame)
}

const cueTimes = (file: string) => readSeratoMarkers(file)?.cues.map((c) => c.ms)

describe('readSeratoMarkers', () => {
  it("reads the hot cues and loops Serato saved in an MP3's GEOB frame", () => {
    const file = withTag(audioFile('mp3'), (f) => addGeob(f, 'Serato Markers2', SERATO_MP3))
    const markers = readSeratoMarkers(file)
    expect(markers?.cues.map((c) => c.ms)).toEqual([
      57606, 71553, 77329, 82467, 88003, 93439, 102387, 109558,
    ])
    expect(markers?.cues[0]).toEqual({ index: 0, ms: 57606, color: 0xcc0000, name: 'A' })
    expect(markers?.loops.map((l) => [l.startMs, l.endMs])).toEqual([
      [57612, 71941],
      [64777, 79105],
    ])
  })

  it('reads the same frame from the ID3 chunk of an AIFF and a WAV', () => {
    const aiff = withTag(audioFile('aiff'), (f) => addGeob(f, 'Serato Markers2', SERATO_AIFF))
    const wav = withTag(audioFile('wav'), (f) => addGeob(f, 'Serato Markers2', SERATO_WAV))
    expect(cueTimes(aiff)).toEqual([45012, 49974, 54874])
    expect(cueTimes(wav)).toEqual([3834, 9192, 16367])
  })

  it("reads the armored value from a FLAC's SERATO_MARKERS_V2 comment", () => {
    const file = withTag(audioFile('flac'), (f) =>
      (f.getTag(TagTypes.Xiph, true) as XiphComment).setFieldAsStrings(
        'SERATO_MARKERS_V2',
        SERATO_FLAC,
      ),
    )
    expect(cueTimes(file)).toEqual([3838, 9204, 14567])
  })

  it("reads the armored value from an M4A's com.serato.dj markersv2 atom", () => {
    const file = withTag(audioFile('m4a'), (f) =>
      (f.tag as Mpeg4AppleTag).setItunesStrings('com.serato.dj', 'markersv2', SERATO_M4A),
    )
    expect(cueTimes(file)).toEqual([7444, 12756, 19019])
  })

  it('finds the Serato frame behind another program GEOB, the order Mixed In Key leaves', () => {
    const file = withTag(audioFile('mp3'), (f) => {
      addGeob(f, 'CuePoints', Buffer.from('{"cues":[]}').toString('base64'))
      addGeob(f, 'Serato Markers2', SERATO_AIFF)
    })
    expect(cueTimes(file)).toEqual([45012, 49974, 54874])
  })

  it('opens a track without cues instead of failing when the file is missing or carries no tag', () => {
    expect(readSeratoMarkers(join(tmpdir(), 'surco-serato-missing', 'gone.mp3'))).toBeNull()
    expect(readSeratoMarkers(audioFile('mp3'))).toBeNull()
    expect(readSeratoMarkers(audioFile('flac'))).toBeNull()
    expect(readSeratoMarkers(audioFile('m4a'))).toBeNull()
  })

  it('reads an .mp4 the same way as an .m4a, since both are the same container', () => {
    const file = withTag(audioFile('mp4'), (f) =>
      (f.tag as Mpeg4AppleTag).setItunesStrings('com.serato.dj', 'markersv2', SERATO_M4A),
    )
    expect(cueTimes(file)).toEqual([7444, 12756, 19019])
  })

  it('never changes the file it reads, since Surco does not write to Serato in this phase', () => {
    const mp3 = withTag(audioFile('mp3'), (f) => addGeob(f, 'Serato Markers2', SERATO_MP3))
    const flac = withTag(audioFile('flac'), (f) =>
      (f.getTag(TagTypes.Xiph, true) as XiphComment).setFieldAsStrings(
        'SERATO_MARKERS_V2',
        SERATO_FLAC,
      ),
    )
    for (const file of [mp3, flac]) {
      const before = readFileSync(file)
      expect(readSeratoMarkers(file)?.cues.length).toBeGreaterThan(0)
      expect(readFileSync(file).equals(before)).toBe(true)
    }
  })
})
