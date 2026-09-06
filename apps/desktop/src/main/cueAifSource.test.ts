import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { File as TagFile, TagTypes, type XiphComment } from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'
import type { TrackMetadata } from '../shared/types'
import { decodeBase91 } from './base91'
import { convertAudio } from './ffmpeg'
import { buildTraktorTree, readTraktorCueStart, traktorCue } from './traktor4Fixture'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

const FF = ffmpegStatic as unknown as string
const DROP_MS = 79672.64

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

function cueTree(): Uint8Array {
  return buildTraktorTree([traktorCue('AutoGrid', 4, 143.38, 0), traktorCue('Drop', 0, DROP_MS, 1)])
}

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

// Appends an AIFF 'ID3 ' chunk holding the cue tag, fixing up the FORM size — the shape
// a real Traktor-written AIFF carries, whichever of the two extensions it wears.
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

// The FLAC side stores the same tree armored as base91 in a TRAKTOR4 Vorbis comment.
function storedTree(file: string): Uint8Array | null {
  const f = TagFile.createFromPath(file)
  try {
    const xiph = f.getTag(TagTypes.Xiph, false) as XiphComment | null
    const value = xiph?.getFieldFirstValue('TRAKTOR4')
    return value ? decodeBase91(value) : null
  } finally {
    f.dispose()
  }
}

// tags.ts's ID3_SOURCED lists '.mp3', '.aiff', '.wav' — but NOT '.aif', even though
// expand.ts imports both spellings and shared/format.ts says "AIFF rips use both .aif
// and .aiff". keepsCuesInId3 is asked about the source extension, so a .aif source is
// treated as if it kept no ID3 cues at all and the carry-over is skipped.
//
// The existing cueMatrix.test.ts enumerates SOURCES = ['.flac','.mp3','.aiff','.wav'],
// which is why this cell was never covered — the matrix's own comment says enumerating
// it is what turns "we fixed the one that was reported" into "we checked all of them".
describe('a .aif source carries its cues like a .aiff one', () => {
  it('keeps the Traktor cues and beatgrid converting .aif to FLAC', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'surco-aif-'))
    const input = join(dir, 'in.aif')
    execFileSync(FF, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=4',
      input,
    ])
    injectAiffPriv(input, cueTree())
    const out = join(dir, 'out.flac')

    await convertAudio(input, out, 'flac', meta)

    // A DJ whose rips are named .aif loses every hot cue and the beatgrid, silently,
    // on a conversion that reports success — the same loss that was fixed for WAV.
    const tree = storedTree(out)
    expect(tree, '.aif → .flac lost its cues').not.toBeNull()
    expect(readTraktorCueStart(tree as Uint8Array, 1), '.aif → .flac moved the cue').toBeCloseTo(
      DROP_MS,
    )
  })
})
