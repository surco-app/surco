import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  type Id3v2Tag,
  Id3v2UserTextInformationFrame,
  File as TagFile,
  TagTypes,
} from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'
import type { TrackMetadata } from '../shared/types'
import { encodeBase91 } from './base91'
import { automaticCueOffsetOfFiles } from './cueCalibration'
import { convertAudio } from './ffmpeg'
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
