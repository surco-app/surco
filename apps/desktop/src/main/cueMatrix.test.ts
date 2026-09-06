import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  Id3v2PrivateFrame,
  type Id3v2Tag,
  Id3v2UserTextInformationFrame,
  File as TagFile,
  TagTypes,
  type XiphComment,
} from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'
import type { TrackMetadata } from '../shared/types'
import { decodeBase91, encodeBase91 } from './base91'
import { convertAudio } from './ffmpeg'
import { buildTraktorTree, readTraktorCueStart, traktorCue } from './traktor4Fixture'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

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

// A raw ID3v2.3 tag holding Traktor's PRIV frame — the shape a real Traktor-written MP3
// or AIFF carries, and the one this matrix asserts on the way out.
function id3WithPriv(tree: Uint8Array): Buffer {
  const body = Buffer.concat([
    Buffer.from('TRAKTOR4', 'latin1'),
    Buffer.from([0]),
    Buffer.from(tree),
  ])
  const head = Buffer.alloc(10)
  head.write('PRIV', 0, 'latin1')
  head.writeUInt32BE(body.length, 4)
  const frame = Buffer.concat([head, body])
  const syncsafe = (n: number) =>
    Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), syncsafe(frame.length), frame])
}

// Appends an AIFF 'ID3 ' chunk holding the cue tag, fixing up the FORM size.
function injectAiffPriv(path: string, tree: Uint8Array): void {
  const base = readFileSync(path)
  const id3 = id3WithPriv(tree)
  const body = id3.length % 2 ? Buffer.concat([id3, Buffer.from([0])]) : id3
  const size = Buffer.alloc(4)
  size.writeUInt32BE(id3.length)
  const out = Buffer.concat([base, Buffer.from('ID3 '), size, body])
  out.writeUInt32BE(out.length - 8, 4)
  writeFileSync(path, out)
}

// Appends a RIFF 'id3 ' chunk to a WAV, fixing up the RIFF size.
function injectWavPriv(path: string, tree: Uint8Array): void {
  const base = readFileSync(path)
  const id3 = id3WithPriv(tree)
  const body = id3.length % 2 ? Buffer.concat([id3, Buffer.from([0])]) : id3
  const size = Buffer.alloc(4)
  size.writeUInt32LE(id3.length)
  const out = Buffer.concat([base, Buffer.from('id3 '), size, body])
  out.writeUInt32LE(out.length - 8, 4)
  writeFileSync(path, out)
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

// The cue tree as the destination container actually stores it: a PRIV frame for the ID3
// families, the armored Vorbis comment for FLAC. Returns null when neither is present —
// which is exactly the "cues silently lost" outcome this matrix is looking for.
function storedTree(file: string): Uint8Array | null {
  const f = TagFile.createFromPath(file)
  try {
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
    const priv = (id3?.frames ?? []).find(
      (fr) => fr instanceof Id3v2PrivateFrame && fr.owner === 'TRAKTOR4',
    ) as Id3v2PrivateFrame | undefined
    if (priv) return priv.privateData.toByteArray()
    const xiph = f.getTag(TagTypes.Xiph, false) as XiphComment | null
    const armored = xiph?.getField('TRAKTOR4')?.[0]
    return armored ? decodeBase91(armored) : null
  } finally {
    f.dispose()
  }
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
        expect(
          readTraktorCueStart(tree as Uint8Array, 1),
          `${src} → ${target.ext} moved the cue`,
        ).toBeCloseTo(DROP_MS)
        expect(hasTextMirror(out), `${src} → ${target.ext} left ffmpeg's TXXX behind`).toBe(false)
      })
    }
  }
})
