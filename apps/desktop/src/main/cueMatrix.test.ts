import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import log from 'electron-log/main'
import ffmpegStatic from 'ffmpeg-static'
import {
  ByteVector,
  Id3v2AttachmentFrame,
  Id3v2PrivateFrame,
  type Id3v2Tag,
  Id3v2UserTextInformationFrame,
  type Mpeg4AppleTag,
  Picture,
  PictureType,
  StringType,
  File as TagFile,
  TagTypes,
  type XiphComment,
} from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'
import { withSeratoCues } from '../shared/seratoMarkers'
import { seratoV1Armored, seratoV1Block } from '../shared/seratoMarkersFixture'
import type { TrackMetadata } from '../shared/types'
import { encodeBase91 } from './base91'
import { automaticCueOffsetOfFiles } from './cueCalibration'
import { convertAudio } from './ffmpeg'
import { recordedRekordboxRepoint } from './rekordboxBatch'
import { seratoLeadOfFile } from './seratoClock'
import { readSeratoTrack, setSeratoMarkers } from './seratoTags'
import { snapshotTags } from './tagSnapshot'
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

function seratoGeob(
  description: string,
  body: Uint8Array = Uint8Array.from([1, 1, 65, 65, 65, 65]),
): Id3v2AttachmentFrame {
  const picture = Picture.fromFullData(
    ByteVector.fromByteArray(body),
    PictureType.NotAPicture,
    'application/octet-stream',
    description,
  )
  picture.filename = ''
  const frame = Id3v2AttachmentFrame.fromPicture(picture)
  frame.textEncoding = StringType.Latin1
  return frame
}

function makeSeratoSource(
  dir: string,
  ext: string,
  withTraktor = true,
  oldCues: number[] = [SERATO_CUE_MS],
): string {
  const path =
    ext === '.m4a' || ext === '.flac' || !withTraktor ? join(dir, `in${ext}`) : makeSource(dir, ext)
  if (ext === '.mp3' && !withTraktor)
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
  const f = TagFile.createFromPath(path)
  if (ext === '.m4a') {
    const apple = f.tag as Mpeg4AppleTag
    apple.setItunesStrings('com.serato.dj', 'overview', 'AQFBQUFB')
    apple.setItunesStrings('com.serato.dj', 'markers', seratoV1Armored(oldCues))
  }
  if (ext !== '.m4a' && ext !== '.flac') {
    const tag = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
    tag.addFrame(seratoGeob('Serato Overview'))
    tag.addFrame(seratoGeob('Serato Markers_', seratoV1Block(oldCues)))
  }
  f.save()
  f.dispose()
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
      ...(/\.m4a$/.test(file) &&
      (f.tag as Mpeg4AppleTag).getItunesStrings('com.serato.dj', 'overview').length > 0
        ? ['serato overview atom']
        : []),
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
        expect(after?.cue[0]).toBeCloseTo(before?.cue[0] ?? Number.NaN, 0)
        expect(after?.loop[0][0]).toBeCloseTo(before?.loop[0][0] ?? Number.NaN, 0)
        expect(after?.loop[0][1]).toBeCloseTo(before?.loop[0][1] ?? Number.NaN, 0)
        if (src !== '.m4a' && target.ext !== '.m4a')
          expect(storedTree(out), `${src} → ${target.ext} lost Traktor's cues`).not.toBeNull()
        if (src !== target.ext || !(src === '.mp3' || src === '.aiff'))
          expect(seratoLeftovers(out), `${src} → ${target.ext} carried raw Serato data`).toEqual([])
        else
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
    expect(after?.cue[0]).toBeCloseTo(SERATO_CUE_MS - 500, 0)
    expect(after?.loop[0]).toEqual([
      expect.closeTo(SERATO_LOOP[0] - 500, 0),
      expect.closeTo(SERATO_LOOP[1] - 500, 0),
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

    expect((await surcoMs(out))?.cue[0]).toBeCloseTo(SERATO_CUE_MS, 0)
  })

  it('writes a WAV cue past the header frame and the encoder delay in the MP3, where Serato plays that audio', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-lead-'))
    const input = makeSeratoSource(dir, '.wav')
    const out = join(dir, 'out.mp3')

    await convertAudio(input, out, 'mp3', meta)

    expect(readSeratoTrack(out)?.markers?.cues[0].ms).toBe(
      SERATO_CUE_MS + Math.round(((1152 + 576 + 529) / 44100) * 1000),
    )
  })

  it.each([['.m4a', '.mp3', 'mp3']] as const)(
    'gives a %s converted to %s no tag beyond the ones the same conversion writes without Serato',
    async (src, ext, format) => {
      const dir = mkdtempSync(join(tmpdir(), 'surco-serato-ghosts-'))
      const input = makeSeratoSource(dir, src, false)
      const plain = join(dir, `plain${src}`)
      execFileSync(FF, [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=d=4',
        '-c:a',
        src === '.m4a' ? 'aac' : 'libmp3lame',
        plain,
      ])
      const out = join(dir, `out${ext}`)
      const control = join(dir, `control${ext}`)

      await convertAudio(input, out, format, meta)
      await convertAudio(plain, control, format, meta)

      expect(readSeratoTrack(out)?.markers?.cues).toHaveLength(1)
      const kinds = (file: string) => {
        const f = TagFile.createFromPath(file)
        try {
          return f.tagTypesOnDisk
        } finally {
          f.dispose()
        }
      }
      expect(kinds(out)).toBe(kinds(control))
      expect(snapshotTags(out).includes('id3v1 present')).toBe(
        snapshotTags(control).includes('id3v1 present'),
      )
    },
  )

  it.each([
    ['.mp3', '.flac', 'flac'],
    ['.m4a', '.mp3', 'mp3'],
    ['.mp3', '.mp3', 'mp3'],
  ] as const)(
    'carries no Serato cue from a %s whose older cue block disagrees, converting to %s',
    async (src, ext, format) => {
      const dir = mkdtempSync(join(tmpdir(), 'surco-serato-old-'))
      const input = makeSeratoSource(dir, src, src !== '.mp3', [SERATO_CUE_MS + 400])
      const out = join(dir, `out${ext}`)

      await convertAudio(
        input,
        out,
        format,
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

      expect(readSeratoTrack(out)?.markers ?? null).toBeNull()
      expect(seratoLeftovers(out)).not.toContain('Serato Markers_')
    },
  )

  it('leaves an MP3 copied as it is with both of the Serato blocks it came with', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-oldcopy-'))
    const input = makeSeratoSource(dir, '.mp3', false, [SERATO_CUE_MS + 400])
    const out = join(dir, 'out.mp3')

    await convertAudio(input, out, 'mp3', meta)

    expect(readSeratoTrack(out)?.payload).toEqual(readSeratoTrack(input)?.payload)
    expect(readSeratoTrack(out)?.oldBlockDisagrees).toBe(true)
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

  // The DJ's cues are left out of the output when the clock cannot be measured: the log must
  // say so, or a support report has nothing to explain where they went.
  it('says in the log that the Serato cues were not carried when the clock cannot be measured', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-fails-log-'))
    const input = makeSeratoSource(dir, '.aiff')
    const out = join(dir, 'out.mp3')
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined as never)

    seratoLeadFails = true
    try {
      await convertAudio(input, out, 'mp3', meta)
    } finally {
      seratoLeadFails = false
    }

    const calls = warn.mock.calls.map(([line]) => String(line))
    warn.mockRestore()
    expect(calls).toContainEqual(expect.stringContaining('Serato cues not carried to out.mp3'))
  })

  // An ordinary conversion must still take the old analysis off when Serato's clock cannot
  // be measured, as it does for a source it cannot read: only a replacement fails the carry.
  it('still strips the Serato analysis of a source with a grid and no cues when the clock cannot be measured', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-gridonly-fails-'))
    const input = join(dir, 'in.flac')
    execFileSync(FF, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=4',
      '-metadata',
      'SERATO_OVERVIEW=AQFBQUFB',
      input,
    ])
    withSeratoGrid(input)
    const out = join(dir, 'out.mp3')

    seratoLeadFails = true
    try {
      await convertAudio(input, out, 'mp3', meta)
    } finally {
      seratoLeadFails = false
    }

    expect(seratoLeftovers(out)).toEqual([])
  })

  it('drops what a FLAC re-encode carried of Serato analysis when a trim moves the audio', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-flactrim-'))
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
    )

    expect(seratoLeftovers(out)).toEqual([])
    expect((await surcoMs(out))?.cue[0]).toBeCloseTo(SERATO_CUE_MS - 500, 0)
  })

  for (const [format, ext] of [
    ['mp3', '.mp3'],
    ['aiff', '.aiff'],
  ] as const)
    it(`strips Serato analysis from a ${ext} copy whose Traktor cues the offset moved`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'surco-serato-copyoffset-'))
      const input = makeSeratoSource(dir, ext)
      const out = join(dir, `out${ext}`)

      traktorCueOffsetMs = OFFSET_MS
      try {
        await convertAudio(input, out, format, meta)
      } finally {
        traktorCueOffsetMs = 0
      }

      expect(seratoLeftovers(out)).toEqual([])
      expect((await surcoMs(out))?.cue[0]).toBeCloseTo((await surcoMs(input))?.cue[0] ?? 0, 0)
      expect(storedTree(out)).not.toBeNull()
    })

  it('strips Serato analysis from an MP3 copy the offset touched even with no Traktor cues', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-copyonly-'))
    const input = makeSeratoSource(dir, '.mp3', false)
    const out = join(dir, 'out.mp3')

    traktorCueOffsetMs = OFFSET_MS
    try {
      await convertAudio(input, out, 'mp3', meta)
    } finally {
      traktorCueOffsetMs = 0
    }

    expect(seratoLeftovers(out)).toEqual([])
    expect((await surcoMs(out))?.cue[0]).toBeCloseTo((await surcoMs(input))?.cue[0] ?? 0, 0)
  })

  it('moves Traktor cues in an MP3 copy whose ID3 v2.3 tag also holds Serato objects', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-v23-'))
    const input = makeSeratoSource(dir, '.mp3', false)
    const f = TagFile.createFromPath(input)
    const priv = Id3v2PrivateFrame.fromOwner('TRAKTOR4')
    priv.privateData = ByteVector.fromByteArray(cueTree())
    ;(f.getTag(TagTypes.Id3v2, true) as Id3v2Tag).addFrame(priv)
    f.save()
    f.dispose()
    const out = join(dir, 'out.mp3')

    traktorCueOffsetMs = OFFSET_MS
    try {
      await convertAudio(input, out, 'mp3', meta)
    } finally {
      traktorCueOffsetMs = 0
    }

    expect(readTraktorCueStart(storedTree(out) as Uint8Array, 1)).toBeCloseTo(
      DROP_MS + OFFSET_MS,
      0,
    )
  })

  it('still cleans Serato data off the output when the DJ deleted the markers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-removedmp3-'))
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
      undefined,
      false,
      ['serato_markers_v2'],
    )

    expect(seratoLeftovers(out)).toEqual([])
    expect(readSeratoTrack(out)?.markers).toBeNull()
  })

  it('drops the cues and loops a trim cut away instead of piling them at the start', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-cut-'))
    const input = makeSeratoSource(dir, '.wav')
    const out = join(dir, 'out.wav')

    await convertAudio(
      input,
      out,
      'wav',
      meta,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { startSec: 1.5 },
    )

    expect(await surcoMs(out)).toEqual({ cue: [SERATO_CUE_MS - 1500], loop: [] })
  })
})

function plainSine(dir: string, ext: string): string {
  const path = join(dir, `download${ext}`)
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
  return path
}

function replace(
  download: string,
  out: string,
  replaced: string,
  trim?: { startSec: number },
): ReturnType<typeof convertAudio> {
  return convertAudio(
    download,
    out,
    'aiff',
    meta,
    undefined,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    trim,
    undefined,
    undefined,
    replaced,
  )
}

describe('a replacement carries the Serato cues of the file it replaces', () => {
  // The download never was in Serato: the cues the DJ set live in the file it replaces,
  // and that file is retired once the check comes back.
  it("writes the replaced file's Serato cues into the new file, not the download's", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-replace-'))
    const replaced = makeSeratoSource(dir, '.mp3', false)
    const download = plainSine(dir, '.flac')
    const out = join(dir, 'out.aiff')

    await replace(download, out, replaced)

    expect((await surcoMs(out))?.cue[0]).toBeCloseTo(
      (await surcoMs(replaced))?.cue[0] ?? Number.NaN,
      0,
    )
  })

  // Nothing to lose: a replaced file with no Serato cues must not wipe what the new one has.
  it("keeps the download's own Serato cues when the replaced file has none", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-replace-none-'))
    const replaced = plainSine(dir, '.mp3')
    const download = makeSeratoSource(dir, '.aiff')
    const out = join(dir, 'out.aiff')

    await replace(download, out, replaced)

    expect((await surcoMs(out))?.cue[0]).toBeCloseTo(SERATO_CUE_MS, 0)
  })

  // A FLAC keeps its cues in a Vorbis comment the AIFF cannot hold: only the carry brings
  // them across, so a carry that read nothing from the replaced file must still run from the download.
  it("keeps a FLAC download's own Serato cues when the replaced file has none", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-replace-none-flac-'))
    const replaced = plainSine(dir, '.mp3')
    const download = makeSeratoSource(dir, '.flac')
    const out = join(dir, 'out.aiff')

    await replace(download, out, replaced)

    expect((await surcoMs(out))?.cue[0]).toBeCloseTo(SERATO_CUE_MS, 0)
    expect(recordedRekordboxRepoint(out)?.seratoCarryFailed).toBeUndefined()
  })

  // The measure of phase 3 is taken on the finished file, trim included: taking the trim
  // off again here would move the cues twice.
  it("does not take a trim off the replaced file's cues", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-replace-trim-'))
    const replaced = makeSeratoSource(dir, '.mp3', false)
    const download = plainSine(dir, '.flac')
    const out = join(dir, 'out.aiff')

    await replace(download, out, replaced, { startSec: 0.5 })

    expect((await surcoMs(out))?.cue[0]).toBeCloseTo(
      (await surcoMs(replaced))?.cue[0] ?? Number.NaN,
      0,
    )
  })

  // Serato must not be pointed at a file that lacks the cues it had: the repoint says so.
  it('says so on the repoint when the replaced file could not be read, so Serato is not pointed at a file without its cues', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-replace-gone-'))
    const download = plainSine(dir, '.flac')
    const out = join(dir, 'out.aiff')

    await replace(download, out, join(dir, 'gone.mp3'))

    expect(recordedRekordboxRepoint(out)).toMatchObject({ replaced: true, seratoCarryFailed: true })
  })

  // "To review" is recorded from the conversion's result, not from the repoint: without the
  // flag there it lists Serato as moved while Serato stays on the replaced file.
  it('says so in what it wrote when the replaced file could not be read, so To review leaves Serato out', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-replace-gone-written-'))
    const download = plainSine(dir, '.flac')
    const out = join(dir, 'out.aiff')

    const { written } = await replace(download, out, join(dir, 'gone.mp3'))

    expect(written.seratoCarryFailed).toBe(true)
  })

  it('does not flag a failed carry when the replaced file was read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-replace-ok-'))
    const replaced = makeSeratoSource(dir, '.mp3', false)
    const download = plainSine(dir, '.flac')
    const out = join(dir, 'out.aiff')

    const { written } = await replace(download, out, replaced)

    expect(recordedRekordboxRepoint(out)?.seratoCarryFailed).toBeUndefined()
    expect(written.seratoCarryFailed).toBeUndefined()
  })

  // Emptying the tags of the new file does not empty the replaced one, which Serato still
  // reads: pointing Serato at the copy and retiring that file would lose its cues.
  it('keeps Serato on the replaced file when the DJ empties every tag of its replacement', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-replace-clear-'))
    const replaced = makeSeratoSource(dir, '.mp3', false)
    const out = join(dir, 'out.aiff')

    await convertAudio(
      plainSine(dir, '.flac'),
      out,
      'aiff',
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
      undefined,
      replaced,
    )

    expect(recordedRekordboxRepoint(out)).toMatchObject({ replaced: true, seratoCarryFailed: true })
  })

  // A download already in the output format is copied as it is, with no carry to run; the
  // Serato field deleted in the inspector must still keep Serato on the replaced file.
  it('keeps Serato on the replaced file when the DJ deletes the Serato markers of a replacement copied as it is', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-replace-inspector-'))
    const replaced = makeSeratoSource(dir, '.mp3', false)
    const out = join(dir, 'out.aiff')

    await convertAudio(
      plainSine(dir, '.aiff'),
      out,
      'aiff',
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
      undefined,
      ['SERATO_MARKERS_V2'],
      replaced,
    )

    expect(recordedRekordboxRepoint(out)).toMatchObject({ replaced: true, seratoCarryFailed: true })
  })

  // In an MP3 or M4A Serato shows the old cue block and ignores Markers2 (measured 03/11):
  // the cues the DJ saw are the old block's, and those are the ones the new file must hold.
  it.each(['.mp3', '.m4a'])(
    'carries the cues of the old block a %s replaced file shows in Serato when its Markers2 disagrees',
    async (ext) => {
      const dir = mkdtempSync(join(tmpdir(), 'surco-serato-replace-v1-'))
      const replaced = makeSeratoSource(dir, ext, false, [SERATO_CUE_MS + 400])
      const download = plainSine(dir, '.flac')
      const out = join(dir, 'out.aiff')

      await replace(download, out, replaced)

      const lead = await seratoLeadOfFile(replaced, readSeratoTrack(replaced)?.sampleRate ?? 44100)
      expect((await surcoMs(out))?.cue).toEqual([expect.closeTo(SERATO_CUE_MS + 400 - lead, 0)])
      expect(recordedRekordboxRepoint(out)?.seratoCarryFailed).toBeUndefined()
    },
  )

  // A file Serato only ever wrote the old block to still holds the DJ's cues: falling back to
  // the download's would put cues the DJ never set where Serato is pointed.
  it("carries the cues of an MP3 replaced file that holds only the old block, not the download's", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-replace-v1only-'))
    const replaced = plainSine(dir, '.mp3')
    const f = TagFile.createFromPath(replaced)
    ;(f.getTag(TagTypes.Id3v2, true) as Id3v2Tag).addFrame(
      seratoGeob('Serato Markers_', seratoV1Block([SERATO_CUE_MS + 400])),
    )
    f.save()
    f.dispose()
    const download = makeSeratoSource(dir, '.flac')
    const out = join(dir, 'out.aiff')

    await replace(download, out, replaced)

    const lead = await seratoLeadOfFile(replaced, 44100)
    expect((await surcoMs(out))?.cue).toEqual([expect.closeTo(SERATO_CUE_MS + 400 - lead, 0)])
    expect(recordedRekordboxRepoint(out)?.seratoCarryFailed).toBeUndefined()
  })
})

function tempoMap(firstBeatSeconds: number, bpm: number): Uint8Array {
  const data = new Uint8Array(40)
  const view = new DataView(data.buffer)
  view.setUint16(0, 0x0200)
  view.setUint16(2, 1)
  view.setFloat64(4, firstBeatSeconds)
  view.setUint32(12, 1)
  view.setFloat64(24, bpm)
  view.setUint32(36, 1)
  return data
}

function withSeratoGrid(file: string): string {
  const f = TagFile.createFromPath(file)
  try {
    if (file.endsWith('.flac'))
      (f.getTag(TagTypes.Xiph, true) as XiphComment).setFieldAsStrings(
        'SERATO_TEMPO_MAP',
        Buffer.concat([
          Buffer.from('application/octet-stream\0\0Serato Tempo Map\0', 'latin1'),
          tempoMap(1, 120),
        ]).toString('base64'),
      )
    else
      (f.getTag(TagTypes.Id3v2, true) as Id3v2Tag).addFrame(
        seratoGeob('Serato Tempo Map', tempoMap(1, 120)),
      )
    f.save()
  } finally {
    f.dispose()
  }
  return file
}

async function gridOnAudio(file: string): Promise<number> {
  const track = readSeratoTrack(file)
  return (
    (track?.tempoMap?.firstBeatMs ?? Number.NaN) -
    (await seratoLeadOfFile(file, track?.sampleRate ?? 44100))
  )
}

// A DJ who fixed the grid by hand in Serato loses that work if a conversion drops it:
// Serato re-analyses a track with no grid and lands wherever its detector says.
describe('a hand-set Serato grid', () => {
  it('keeps a hand-set Serato grid on the same beat from FLAC to MP3, where the MP3 clock starts later', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-grid-'))
    const input = withSeratoGrid(makeSeratoSource(dir, '.flac'))
    const out = join(dir, 'out.mp3')

    await convertAudio(input, out, 'mp3', meta)

    expect(Math.abs((await gridOnAudio(out)) - (await gridOnAudio(input)))).toBeLessThan(1)
    expect(await seratoLeadOfFile(out, 44100)).toBeGreaterThan(await seratoLeadOfFile(input, 44100))
  })

  // The grid the DJ set lives in the file being replaced, like its cues; the download's
  // own analysis never was in Serato.
  it("keeps the replaced file's Serato grid in its replacement", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-grid-replace-'))
    const replaced = withSeratoGrid(makeSeratoSource(dir, '.mp3', false))
    const download = plainSine(dir, '.flac')
    const out = join(dir, 'out.aiff')

    await replace(download, out, replaced)

    expect(Math.abs((await gridOnAudio(out)) - (await gridOnAudio(replaced)))).toBeLessThan(1)
  })

  // A grid the DJ fixed is Serato data of the replaced file even with no cues: falling back
  // to the download would throw that work away for an analysis that never was in Serato.
  it.each(['.flac', '.aiff'])(
    "keeps the replaced file's grid, and none of the %s download's cues, when the replaced file has a grid but no cues",
    async (ext) => {
      const dir = mkdtempSync(join(tmpdir(), 'surco-serato-grid-replace-gridonly-'))
      const replaced = withSeratoGrid(plainSine(dir, '.mp3'))
      const download = makeSeratoSource(dir, ext)
      const out = join(dir, 'out.aiff')

      await replace(download, out, replaced)

      expect(Math.abs((await gridOnAudio(out)) - (await gridOnAudio(replaced)))).toBeLessThan(1)
      expect(readSeratoTrack(out)?.markers ?? null).toBeNull()
    },
  )

  // A grid alone is the replaced file's Serato data: without the clock it cannot be placed,
  // and Serato must not be pointed at a file that lost it.
  it('fails the carry of a replaced file with only a grid when the clock cannot be measured', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-grid-replace-fails-'))
    const replaced = withSeratoGrid(plainSine(dir, '.mp3'))
    const download = plainSine(dir, '.flac')
    const out = join(dir, 'out.aiff')

    seratoLeadFails = true
    try {
      await replace(download, out, replaced)
    } finally {
      seratoLeadFails = false
    }

    expect(recordedRekordboxRepoint(out)).toMatchObject({ replaced: true, seratoCarryFailed: true })
  })

  // The old cue block is cues too: one a download brought along was never the DJ's in Serato.
  it("takes the download's old Serato cue block off a replacement whose file had only a grid", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-grid-replace-v1-'))
    const replaced = withSeratoGrid(plainSine(dir, '.mp3'))
    const download = plainSine(dir, '.aiff')
    const f = TagFile.createFromPath(download)
    ;(f.getTag(TagTypes.Id3v2, true) as Id3v2Tag).addFrame(
      seratoGeob('Serato Markers_', seratoV1Block([SERATO_CUE_MS])),
    )
    f.save()
    f.dispose()
    const out = join(dir, 'out.aiff')

    await replace(download, out, replaced)

    expect(seratoLeftovers(out)).not.toContain('Serato Markers_')
    expect(Math.abs((await gridOnAudio(out)) - (await gridOnAudio(replaced)))).toBeLessThan(1)
  })

  // A grid Surco cannot move would be lost with the replaced file it retires.
  it('keeps Serato on the replaced file when its grid cannot be moved', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-grid-replace-unmovable-'))
    const replaced = makeSeratoSource(dir, '.mp3', false)
    const multi = tempoMap(1, 120)
    new DataView(multi.buffer).setUint16(2, 2)
    const f = TagFile.createFromPath(replaced)
    ;(f.getTag(TagTypes.Id3v2, true) as Id3v2Tag).addFrame(seratoGeob('Serato Tempo Map', multi))
    f.save()
    f.dispose()
    const out = join(dir, 'out.aiff')

    await replace(plainSine(dir, '.flac'), out, replaced)

    expect(recordedRekordboxRepoint(out)).toMatchObject({ replaced: true, seratoCarryFailed: true })
  })

  // When the cues come from the download, so does the grid, on the download's clock.
  it("keeps the download's own grid when the replaced file has no Serato cues", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-serato-grid-replace-none-'))
    const replaced = plainSine(dir, '.mp3')
    const download = withSeratoGrid(makeSeratoSource(dir, '.flac'))
    const out = join(dir, 'out.aiff')

    await replace(download, out, replaced)

    expect(Math.abs((await gridOnAudio(out)) - (await gridOnAudio(download)))).toBeLessThan(1)
  })
})
