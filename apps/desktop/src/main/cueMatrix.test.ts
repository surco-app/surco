import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  ByteVector,
  Id3v2AttachmentFrame,
  type Id3v2Tag,
  Id3v2UserTextInformationFrame,
  Picture,
  PictureType,
  StringType,
  File as TagFile,
  TagTypes,
  type XiphComment,
} from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'
import { withSeratoCues } from '../shared/seratoMarkers'
import type { TrackMetadata } from '../shared/types'
import { encodeBase91 } from './base91'
import { automaticCueOffsetOfFiles } from './cueCalibration'
import { convertAudio } from './ffmpeg'
import { seratoLeadOfFile } from './seratoClock'
import { readSeratoTrack, setSeratoMarkers } from './seratoTags'
import { geobParts } from './tags'
import {
  buildTraktorTree,
  id3WithPriv,
  injectAiffPriv,
  injectWavPriv,
  readTraktorCueStart,
  storedTree,
  traktorCue,
} from './traktor4Fixture'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

// The offset the DJ dials in Settings, read through getSettings by cueShiftFor. Mocking
// it as a fixed 0 is how this matrix stayed green while the setting reached only some of
// the crossings: every row ran with no adjustment to lose.
let traktorCueOffsetMs = 0
vi.mock('./settings', () => ({
  getSettings: () => ({ traktorNmlPath: '', traktorCueOffsetMs }),
}))

let seratoLeadFails = false
vi.mock('./seratoClock', async (original) => {
  const real = await original<typeof import('./seratoClock')>()
  return {
    ...real,
    seratoLeadOfFile: (file: string, sampleRate: number) =>
      seratoLeadFails
        ? Promise.reject(new Error('unreadable head'))
        : real.seratoLeadOfFile(file, sampleRate),
  }
})

const FF = ffmpegStatic as unknown as string

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

const DROP_MS = 79672.64

function cueTree(): Uint8Array {
  return buildTraktorTree([traktorCue('AutoGrid', 4, 143.38, 0), traktorCue('Drop', 0, DROP_MS, 1)])
}

function makeSource(dir: string, ext: string): string {
  const tree = cueTree()
  const path = join(dir, `in${ext}`)
  if (ext === '.flac') {
    execFileSync(FF, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=4',
      '-metadata',
      `TRAKTOR4=${encodeBase91(tree)}`,
      path,
    ])
    return path
  }
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=4',
    path,
  ])
  if (ext === '.wav') injectWavPriv(path, tree)
  else if (ext === '.aiff' || ext === '.aif') injectAiffPriv(path, tree)
  // An MP3 carries its ID3 tag as a plain prefix, not inside a container chunk.
  else writeFileSync(path, Buffer.concat([id3WithPriv(tree), readFileSync(path)]))
  return path
}

// The TXXX ffmpeg synthesises from a Vorbis comment. Traktor never reads it, so a
// destination carrying only this counts as having lost its cues however full it looks.
function hasTextMirror(file: string): boolean {
  const f = TagFile.createFromPath(file)
  try {
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
    return (id3?.frames ?? []).some(
      (fr) => fr instanceof Id3v2UserTextInformationFrame && fr.description === 'TRAKTOR4',
    )
  } finally {
    f.dispose()
  }
}

// Every source→target crossing the converter supports, as one table. The bug djotas
// reported was a single empty cell in it (FLAC→MP3/AIFF); enumerating the whole matrix is
// what turns "we fixed the one that was reported" into "we checked all of them".
// '.aif' is a separate row from '.aiff' and not a duplicate of it: an AIFF rip wears
// either spelling (shared/format.ts says so, expand.ts imports both), and the cue
// carry-over asks the SOURCE extension which tag it keeps its cues in. Listing only the
// long one is exactly how this cell stayed empty while every other crossing was covered.
const SOURCES = ['.flac', '.mp3', '.aiff', '.aif', '.wav'] as const
const TARGETS = [
  { format: 'flac', ext: '.flac' },
  { format: 'mp3', ext: '.mp3' },
  { format: 'aiff', ext: '.aiff' },
  { format: 'wav', ext: '.wav' },
] as const

describe('the cue carry-over matrix', () => {
  for (const src of SOURCES) {
    for (const target of TARGETS) {
      // Same-format conversions take the stream-copy path, which keeps the original bytes
      // and their tag; the crossings are what this matrix is about.
      if (src === target.ext) continue

      it(`carries the cues from ${src} to ${target.ext}`, async () => {
        const dir = mkdtempSync(join(tmpdir(), 'surco-matrix-'))
        const input = makeSource(dir, src)
        const out = join(dir, `out${target.ext}`)

        await convertAudio(input, out, target.format, meta)

        const tree = storedTree(out)
        expect(tree, `${src} → ${target.ext} lost its cues`).not.toBeNull()
        // Not DROP_MS flat: the DJ's directional calibration (cueCalibration.ts) moves
        // the marker on the MP3 crossings, which is the whole point of it. Every other
        // route still has to land exactly where it started.
        expect(
          readTraktorCueStart(tree as Uint8Array, 1),
          `${src} → ${target.ext} moved the cue`,
        ).toBeCloseTo(DROP_MS + (await automaticCueOffsetOfFiles(input, out)), 0)
        expect(hasTextMirror(out), `${src} → ${target.ext} left ffmpeg's TXXX behind`).toBe(false)
      })
    }
  }
})

// The offset was wired into the eight re-encode call sites and verified on the one
// crossing being written at the time (MP3 → FLAC). It reached the user as "the MP3 it
// converts does not have the -51 ms applied": a same-format conversion takes the
// stream-copy branch, which hands writeTags no cueShift at all, so the cues ride across
// untouched. The matrix above could not catch it — it skips same-format rows on the
// premise that they keep the original bytes and tag, which stopped being true the moment
// an offset had to move the cues on every route.
const OFFSET_MS = -51

describe('the cue offset reaches every conversion', () => {
  const ALL_TARGETS = [...TARGETS]

  for (const src of SOURCES) {
    for (const target of ALL_TARGETS) {
      it(`applies the offset from ${src} to ${target.ext}`, async () => {
        const dir = mkdtempSync(join(tmpdir(), 'surco-offset-'))
        const input = makeSource(dir, src)
        const out = join(dir, `out${target.ext}`)

        traktorCueOffsetMs = OFFSET_MS
        try {
          await convertAudio(input, out, target.format, meta)
        } finally {
          traktorCueOffsetMs = 0
        }

        const tree = storedTree(out)
        expect(tree, `${src} → ${target.ext} lost its cues`).not.toBeNull()
        // The setting's sign is the DJ's, not the stored value's: cueShiftFor negates it
        // into a shiftMs that shiftTraktorCues then SUBTRACTS, so a -51 ms adjustment
        // leaves the stored position 51 ms lower. Asserting the other way round is how
        // the first version of this test failed all twenty rows on a bug in itself.
        expect(
          readTraktorCueStart(tree as Uint8Array, 1),
          `${src} → ${target.ext} ignored the cue offset`,
        ).toBeCloseTo(DROP_MS + OFFSET_MS + (await automaticCueOffsetOfFiles(input, out)), 0)
      })
    }
  }
})

const SERATO_CUE_MS = 2000
const SERATO_LOOP = [1000, 3000]

function seratoPayload(): Uint8Array {
  const withCue = withSeratoCues(null, [
    { index: 0, ms: SERATO_CUE_MS, color: 0xcc0000, name: 'Drop' },
  ])
  const loop = new Uint8Array(21)
  loop[1] = 0
  new DataView(loop.buffer).setUint32(2, SERATO_LOOP[0])
  new DataView(loop.buffer).setUint32(6, SERATO_LOOP[1])
  loop.set([255, 255, 255, 255], 14)
  const head = Uint8Array.from([...'LOOP\0'].map((c) => c.charCodeAt(0)))
  const size = new Uint8Array(4)
  new DataView(size.buffer).setUint32(0, loop.length)
  return Uint8Array.from([...withCue, ...head, ...size, ...loop, 0])
}

function seratoGeob(description: string): Id3v2AttachmentFrame {
  const picture = Picture.fromFullData(
    ByteVector.fromByteArray(Uint8Array.from([1, 1, 65, 65, 65, 65])),
    PictureType.NotAPicture,
    'application/octet-stream',
    description,
  )
  picture.filename = ''
  const frame = Id3v2AttachmentFrame.fromPicture(picture)
  frame.textEncoding = StringType.Latin1
  return frame
}

function makeSeratoSource(dir: string, ext: string): string {
  const path =
    ext === '.m4a'
      ? join(dir, 'in.m4a')
      : ext === '.flac'
        ? join(dir, 'in.flac')
        : makeSource(dir, ext)
  if (ext === '.m4a')
    execFileSync(FF, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=4',
      '-c:a',
      'aac',
      path,
    ])
  if (ext === '.flac')
    execFileSync(FF, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=4',
      '-metadata',
      `TRAKTOR4=${encodeBase91(cueTree())}`,
      '-metadata',
      'SERATO_OVERVIEW=AQFBQUFB',
      path,
    ])
  setSeratoMarkers(path, seratoPayload())
  if (ext !== '.m4a' && ext !== '.flac') {
    const f = TagFile.createFromPath(path)
    const tag = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
    tag.addFrame(seratoGeob('Serato Overview'))
    tag.addFrame(seratoGeob('Serato Markers_'))
    f.save()
    f.dispose()
  }
  return path
}

function seratoLeftovers(file: string): string[] {
  const f = TagFile.createFromPath(file)
  try {
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
    const xiph = f.getTag(TagTypes.Xiph, false) as XiphComment | null
    const names = [
      ...(id3?.frames ?? []).map((fr) =>
        fr instanceof Id3v2UserTextInformationFrame
          ? `TXXX ${fr.description}`
          : fr.frameId.toString() === 'GEOB'
            ? (geobParts(fr.render(4).toByteArray())?.description ?? '')
            : '',
      ),
      ...(xiph?.fieldNames ?? []).filter((name) => name !== 'SERATO_MARKERS_V2'),
    ]
    return names.filter((name) => /serato/i.test(name) && name !== 'Serato Markers2')
  } finally {
    f.dispose()
  }
}

async function surcoMs(file: string): Promise<{ cue: number[]; loop: number[][] } | null> {
  const track = readSeratoTrack(file)
  if (!track?.markers) return null
  const lead = await seratoLeadOfFile(file, track.sampleRate)
  return {
    cue: track.markers.cues.map((c) => c.ms - lead),
    loop: track.markers.loops.map((l) => [l.startMs - lead, l.endMs - lead]),
  }
}

const SERATO_SOURCES = ['.flac', '.mp3', '.aiff', '.wav', '.m4a'] as const
const SERATO_TARGETS = [...TARGETS, { format: 'alac', ext: '.m4a' }] as const

describe('the Serato cue carry-over matrix', () => {
  for (const src of SERATO_SOURCES) {
    for (const target of SERATO_TARGETS) {
      it(`keeps the Serato cues on the same audio from ${src} to ${target.ext}`, async () => {
        const dir = mkdtempSync(join(tmpdir(), 'surco-serato-matrix-'))
        const input = makeSeratoSource(dir, src)
        const out = join(dir, `out${target.ext}`)
        const before = await surcoMs(input)

        await convertAudio(input, out, target.format, meta)

        const after = await surcoMs(out)
        expect(after, `${src} → ${target.ext} lost the Serato cues`).not.toBeNull()
        expect(after?.cue[0]).toBeCloseTo(before?.cue[0] ?? Number.NaN, -0.5)
        expect(after?.loop[0][0]).toBeCloseTo(before?.loop[0][0] ?? Number.NaN, -0.5)
        expect(after?.loop[0][1]).toBeCloseTo(before?.loop[0][1] ?? Number.NaN, -0.5)
        if (src !== '.m4a' && target.ext !== '.m4a')
          expect(storedTree(out), `${src} → ${target.ext} lost Traktor's cues`).not.toBeNull()
        if (src !== target.ext)
          expect(seratoLeftovers(out), `${src} → ${target.ext} carried raw Serato data`).toEqual([])
        if (src === target.ext && (src === '.mp3' || src === '.aiff'))
          expect(seratoLeftovers(out), `${src} copy rewrote Serato's tag`).toEqual([
            'Serato Overview',
            'Serato Markers_',
          ])
      })
    }
  }

  it('moves the Serato cues by what a trim cut from the start', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-trim-'))
    const input = makeSeratoSource(dir, '.flac')
    const out = join(dir, 'out.mp3')

    await convertAudio(
      input,
      out,
      'mp3',
      meta,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { startSec: 0.5 },
    )

    const after = await surcoMs(out)
    expect(after?.cue[0]).toBeCloseTo(SERATO_CUE_MS - 500, -0.5)
    expect(after?.loop[0]).toEqual([
      expect.closeTo(SERATO_LOOP[0] - 500, -0.5),
      expect.closeTo(SERATO_LOOP[1] - 500, -0.5),
    ])
  })

  it('leaves the Serato cues where they are when the DJ sets a Traktor cue offset', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-offset-'))
    const input = makeSeratoSource(dir, '.wav')
    const out = join(dir, 'out.flac')

    traktorCueOffsetMs = OFFSET_MS
    try {
      await convertAudio(input, out, 'flac', meta)
    } finally {
      traktorCueOffsetMs = 0
    }

    expect((await surcoMs(out))?.cue[0]).toBeCloseTo(SERATO_CUE_MS, -0.5)
  })

  it('writes a WAV cue one header frame later in the MP3, where Serato plays that audio', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-lead-'))
    const input = makeSeratoSource(dir, '.wav')
    const out = join(dir, 'out.mp3')

    await convertAudio(input, out, 'mp3', meta)

    expect(readSeratoTrack(out)?.markers?.cues[0].ms).toBe(
      SERATO_CUE_MS + Math.round((1152 / 44100) * 1000),
    )
  })

  it('carries nothing when the DJ empties every tag', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-clear-'))
    const input = makeSeratoSource(dir, '.flac')
    const out = join(dir, 'out.flac')

    await convertAudio(
      input,
      out,
      'flac',
      meta,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    )

    expect(readSeratoTrack(out)?.markers).toBeNull()
  })

  it('carries nothing when the DJ deleted the Serato markers in the inspector', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-removed-'))
    const input = makeSeratoSource(dir, '.flac')
    const out = join(dir, 'out.flac')

    await convertAudio(
      input,
      out,
      'flac',
      meta,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { startSec: 0.5 },
      false,
      ['serato_markers_v2'],
    )

    expect(readSeratoTrack(out)?.markers).toBeNull()
  })

  it('still converts, with Traktor cues, when the Serato cues cannot be carried', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-fails-'))
    const input = makeSeratoSource(dir, '.aiff')
    const out = join(dir, 'out.mp3')

    seratoLeadFails = true
    try {
      await convertAudio(input, out, 'mp3', meta)
    } finally {
      seratoLeadFails = false
    }

    expect(storedTree(out)).not.toBeNull()
  })
})
