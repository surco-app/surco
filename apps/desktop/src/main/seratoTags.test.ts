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
import { withSeratoCues } from '../shared/seratoMarkers'
import {
  SERATO_AIFF,
  SERATO_FLAC,
  SERATO_M4A,
  SERATO_MP3,
  SERATO_WAV,
  seratoV1Block,
} from '../shared/seratoMarkersFixture'
import { seratoLeadOfFile } from './seratoClock'
import { carrySeratoCues, readSeratoMarkers, readSeratoTrack, setSeratoMarkers } from './seratoTags'

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

describe('readSeratoTrack', () => {
  it('gives the track number the tags of the file hold', () => {
    const file = withTag(audioFile('mp3'), (f) => {
      f.tag.track = 7
    })
    expect(readSeratoTrack(file)?.trackNo).toBe(7)
  })
})

describe('carrySeratoCues from a track whose older cue block disagrees', () => {
  it('takes both cue blocks off a copy whose clock moved, instead of leaving them at the wrong time', async () => {
    const payload = withSeratoCues(null, [{ index: 0, ms: 2000, color: 0xcc0000, name: '' }])
    const old = Buffer.from(seratoV1Block([2400])).toString('base64')
    const [source, dest] = ['mp3', 'wav'].map((ext) => {
      const file = audioFile(ext)
      setSeratoMarkers(file, payload)
      return withTag(file, (f) => addGeob(f, 'Serato Markers_', old))
    })
    expect(readSeratoTrack(source)?.oldBlockDisagrees).toBe(true)

    await carrySeratoCues(source, dest, { trimMs: 0, carry: true, strip: false, shiftMs: 0 })

    expect(readSeratoMarkers(dest)).toBeNull()
    const f = TagFile.createFromPath(dest)
    try {
      const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
      expect((id3?.frames ?? []).filter((frame) => frame.frameId.toString() === 'GEOB')).toEqual([])
    } finally {
      f.dispose()
    }
  })
})

describe('carrySeratoCues with a shift', () => {
  const carried = async (shiftMs: number) => {
    const source = audioFile('wav')
    setSeratoMarkers(
      source,
      withSeratoCues(null, [{ index: 0, ms: 2000, color: 0xcc0000, name: '' }]),
    )
    const dest = audioFile('wav')
    await carrySeratoCues(source, dest, { trimMs: 0, carry: true, strip: false, shiftMs })
    return readSeratoMarkers(dest)?.cues[0].ms
  }

  // The replaced file and its replacement can be different masters: the same beat sits
  // later in the new one, and a cue left at its old millisecond lands before the drop.
  it('moves the carried cues later by the shift, on top of the clock difference', async () => {
    expect(await carried(120)).toBe(2120)
  })

  // A plain conversion has no shift; the cues must stay exactly where Serato had them.
  it('carries the cues where they were with no shift', async () => {
    expect(await carried(0)).toBe(2000)
  })
})

describe('carrySeratoCues from an unreadable source', () => {
  const geobNames = (file: string) => {
    const f = TagFile.createFromPath(file)
    try {
      const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
      return (id3?.frames ?? [])
        .filter((frame) => frame.frameId.toString() === 'GEOB')
        .map((frame) => (frame as Id3v2AttachmentFrame).description)
    } finally {
      f.dispose()
    }
  }
  const staleDest = () =>
    withTag(audioFile('wav'), (f) => addGeob(f, 'Serato Overview', 'AQFBQUFB'))

  // An ordinary conversion whose source cannot be read still has analysis of the old audio
  // on its output: it must come off, as it did before a replacement needed the failure.
  it('still strips the analysis the output carries when no fallback is given', async () => {
    const dest = staleDest()
    expect(geobNames(dest)).toEqual(['Serato Overview'])

    await carrySeratoCues(join(tmpdir(), 'surco-gone.mp3'), dest, {
      trimMs: 0,
      carry: true,
      strip: true,
      shiftMs: 0,
    })

    expect(geobNames(dest)).toEqual([])
  })

  // A replacement must say it could not read the file it replaces: its caller keeps Serato
  // on that file instead of pointing it at a copy without the cues.
  it('fails when a replacement cannot read the file it replaces', async () => {
    await expect(
      carrySeratoCues(join(tmpdir(), 'surco-gone.mp3'), staleDest(), {
        trimMs: 0,
        carry: true,
        strip: true,
        shiftMs: 0,
        fallback: { source: audioFile('wav'), trimMs: 0 },
      }),
    ).rejects.toThrow()
  })
})

const tempoMap = (firstBeatSeconds: number, bpm: number) => {
  const data = Buffer.alloc(40)
  data.writeUInt16BE(0x0200, 0)
  data.writeUInt16BE(1, 2)
  data.writeDoubleBE(firstBeatSeconds, 4)
  data.writeUInt32BE(1, 12)
  data.writeDoubleBE(bpm, 24)
  data.writeUInt32BE(1, 36)
  return data.toString('base64')
}

const oldBeatGrid = (firstSeconds: number, lastSeconds: number) => {
  const data = Buffer.alloc(6 + 16 + 1)
  data.writeUInt16BE(0x0100, 0)
  data.writeUInt32BE(2, 2)
  data.writeFloatBE(firstSeconds, 6)
  data.writeUInt32BE(16, 10)
  data.writeFloatBE(lastSeconds, 14)
  data.writeFloatBE(128, 18)
  return data.toString('base64')
}

const geobDescriptions = (file: string) => {
  const f = TagFile.createFromPath(file)
  try {
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
    return (id3?.frames ?? [])
      .filter((frame) => frame.frameId.toString() === 'GEOB')
      .map((frame) => (frame as Id3v2AttachmentFrame).description)
  } finally {
    f.dispose()
  }
}

function griddedSource(ext = 'wav'): string {
  const file = audioFile(ext)
  setSeratoMarkers(file, withSeratoCues(null, [{ index: 0, ms: 2000, color: 0xcc0000, name: '' }]))
  return withTag(file, (f) => {
    addGeob(f, 'Serato Overview', 'AQFBQUFB')
    addGeob(f, 'Serato Tempo Map', tempoMap(1, 120))
  })
}

// A DJ who fixed the grid by hand in Serato loses that work if the copy drops it:
// Serato re-analyses a track with no grid and lands wherever its detector says.
describe('carrySeratoCues with a beat grid', () => {
  it('carries the tempo map with the cues, moved by the same amount', async () => {
    const dest = audioFile('wav')

    await carrySeratoCues(griddedSource(), dest, {
      trimMs: 0,
      carry: true,
      strip: false,
      shiftMs: 120,
    })

    expect(readSeratoTrack(dest)?.markers?.cues[0].ms).toBe(2120)
    expect(readSeratoTrack(dest)?.tempoMap).toEqual({
      firstBeatMs: expect.closeTo(1120, 6),
      bpm: 120,
    })
  })

  it('carries the tempo map even when the rest of the Serato analysis is stripped', async () => {
    const dest = withTag(audioFile('wav'), (f) => addGeob(f, 'Serato Overview', 'AQFBQUFB'))

    await carrySeratoCues(griddedSource(), dest, {
      trimMs: 0,
      carry: true,
      strip: true,
      shiftMs: 0,
    })

    expect(geobDescriptions(dest)).not.toContain('Serato Overview')
    expect(readSeratoTrack(dest)?.tempoMap?.firstBeatMs).toBeCloseTo(1000, 6)
  })

  // A copy as it is already holds the same grid, and stripping the analysis takes it off:
  // it must be put back, not skipped because it was already there before the strip.
  it('puts back a grid the copy held already once the strip takes it off', async () => {
    const source = griddedSource()
    const dest = withTag(audioFile('wav'), (f) => addGeob(f, 'Serato Tempo Map', tempoMap(1, 120)))

    await carrySeratoCues(source, dest, { trimMs: 0, carry: true, strip: true, shiftMs: 0 })

    expect(readSeratoTrack(dest)?.tempoMap?.firstBeatMs).toBeCloseTo(1000, 6)
  })

  it('carries no grid when the DJ asked for no Serato data', async () => {
    const dest = audioFile('wav')

    await carrySeratoCues(griddedSource(), dest, {
      trimMs: 0,
      carry: false,
      strip: true,
      shiftMs: 0,
    })

    expect(readSeratoTrack(dest)?.tempoMap).toBeNull()
  })

  // Each container keeps the grid in its own field; one Serato cannot find is as lost as none.
  it.each(['mp3', 'aiff', 'flac', 'm4a'])(
    'writes the tempo map where Serato reads it in a %s, on its clock',
    async (ext) => {
      const source = griddedSource()
      const dest = audioFile(ext)

      await carrySeratoCues(source, dest, { trimMs: 0, carry: true, strip: true, shiftMs: 0 })

      const read = readSeratoTrack(dest)
      const lead =
        (await seratoLeadOfFile(dest, read?.sampleRate ?? 44100)) -
        (await seratoLeadOfFile(source, 44100))
      expect(read?.tempoMap?.firstBeatMs).toBeCloseTo(1000 + lead, 6)
    },
  )

  it('moves every marker of an old BeatGrid with the cues', async () => {
    const source = withTag(griddedSource(), (f) =>
      addGeob(f, 'Serato BeatGrid', oldBeatGrid(1.5, 9.5)),
    )
    const dest = audioFile('flac')

    await carrySeratoCues(source, dest, { trimMs: 0, carry: true, strip: true, shiftMs: 120 })

    const grid = readSeratoTrack(dest)?.grids.beatGrid
    const view = grid ? new DataView(grid.buffer, grid.byteOffset) : null
    expect([view?.getFloat32(6), view?.getFloat32(14)]).toEqual([
      expect.closeTo(1.62, 5),
      expect.closeTo(9.62, 5),
    ])
  })

  it("leaves the copy's own grid alone when the source has none", async () => {
    const source = audioFile('wav')
    setSeratoMarkers(source, withSeratoCues(null, [{ index: 0, ms: 2000, color: 0, name: '' }]))
    const dest = withTag(audioFile('wav'), (f) => addGeob(f, 'Serato Tempo Map', tempoMap(3, 90)))

    await carrySeratoCues(source, dest, { trimMs: 0, carry: true, strip: false, shiftMs: 120 })

    expect(readSeratoTrack(dest)?.tempoMap).toEqual({ firstBeatMs: 3000, bpm: 90 })
  })

  // A tag Surco starts must be ID3v2.3, like every other Serato write: some CDJ, rekordbox
  // and Serato setups mishandle v2.4.
  it('starts a v2.3 tag when the grid is the only Serato data written', async () => {
    const source = withTag(audioFile('wav'), (f) =>
      addGeob(f, 'Serato Tempo Map', tempoMap(1, 120)),
    )
    const dest = audioFile('wav')

    await carrySeratoCues(source, dest, { trimMs: 0, carry: true, strip: false, shiftMs: 0 })

    const f = TagFile.createFromPath(dest)
    try {
      expect((f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null)?.version).toBe(3)
    } finally {
      f.dispose()
    }
  })

  // TagLib doubles every "(" of a v2.3 genre on each save: writing the grid must not turn
  // Beatport's "Techno (Peak Time / Driving)" into "Techno ((Peak Time / Driving)".
  it('keeps the genre as it was when it writes only the grid', async () => {
    const source = withTag(audioFile('wav'), (f) =>
      addGeob(f, 'Serato Tempo Map', tempoMap(1, 120)),
    )
    const dest = join(mkdtempSync(join(tmpdir(), 'surco-serato-tags-')), 'genre.mp3')
    execFileSync(FFMPEG, [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=44100',
      '-t',
      '0.3',
      '-id3v2_version',
      '3',
      '-metadata',
      'genre=Techno (Peak Time / Driving)',
      dest,
      '-y',
    ])

    await carrySeratoCues(source, dest, { trimMs: 0, carry: true, strip: false, shiftMs: 0 })

    expect(readSeratoTrack(dest)?.tempoMap).not.toBeNull()
    const f = TagFile.createFromPath(dest)
    try {
      expect(f.tag.genres).toEqual(['Techno (Peak Time / Driving)'])
    } finally {
      f.dispose()
    }
  })
})
