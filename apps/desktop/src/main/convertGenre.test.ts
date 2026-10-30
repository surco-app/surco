import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { emptyMetadata } from '../shared/metadata'
import type { OutputFormat } from '../shared/types'
import { encodeBase91 } from './base91'
import { convertAudio, readTags } from './ffmpeg'
import { copyCueFrames, copyCuesFromFlac, writeTags } from './tags'
import { buildTraktorTree, id3WithPriv, traktorCue } from './traktor4Fixture'
import { checkFile, fileReaders } from './verifyFile'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-genre-'))
const tone = 'aevalsrc=0.3*sin(2*PI*220*t)+0.1*sin(2*PI*3000*t):s=44100:d=4'

let n = 0
function flacWithCues(): string {
  const path = join(dir, `in-${n++}.flac`)
  const tree = buildTraktorTree([traktorCue('Drop', 0, 1000, 0)])
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    tone,
    '-ac',
    '2',
    '-metadata',
    `TRAKTOR4=${encodeBase91(tree)}`,
    path,
  ])
  return path
}

const GENRES = [
  'House; Deep House',
  'Drum & Bass / Jungle',
  'Techno (Peak Time / Driving)',
  'Hip Hop/Rap',
]

// Plex splits a genre on ';', so its users join several with "; ". ID3v2.3 has no list
// separator of its own and TagLib reads one into two values, then writes them back as
// the ID3v1 number of the first: the cue pass that carries a FLAC's Traktor cues over
// re-saved "House; Deep House" as "(35) Deep House", which every DJ tool shows as junk.
describe('convertAudio — a genre that holds several on ID3v2.3 targets', () => {
  it.each(
    (['mp3', 'aiff'] as OutputFormat[]).flatMap((format) =>
      GENRES.flatMap((genre) => [[format, genre, ''] as const, [format, genre, 'C'] as const]),
    ),
  )(
    'a FLAC with Traktor cues converted to %s keeps the genre "%s" as written (comment "%s")',
    async (format, genre, comment) => {
      const meta = { ...emptyMetadata(), title: 'T', genre, comment }
      const out = join(dir, `out-${n++}.${format}`)
      const { written } = await convertAudio(flacWithCues(), out, format, meta)
      expect((await readTags(out)).genre).toBe(genre)
      const check = await checkFile(
        {
          path: out,
          ext: written.plan.ext,
          codec: written.plan.codec,
          bitDepth: written.plan.bitDepth,
          samplesKept: written.samplesKept,
          sourcePcm: written.sourcePcm,
          sourceDurationSec: written.sourceDurationSec,
          trimmedSec: written.trimmedSec,
          tags: meta,
          cover: 'untouched',
          ...(written.proven ? { proven: written.proven } : {}),
        },
        fileReaders,
      )
      expect(check.state, JSON.stringify(check.detail)).toBe('ok')
    },
    30_000,
  )
})

function tconText(path: string): string {
  const bytes = readFileSync(path)
  const at = bytes.indexOf('TCON')
  const body = bytes.subarray(at + 10, at + 10 + bytes.readUInt32BE(at + 4))
  const text =
    body[0] === 1 ? body.subarray(3).toString('utf16le') : body.subarray(1).toString('latin1')
  return text.replace(/\0+$/, '')
}

// TagLib escapes every '(' of a v2.3 genre as '((' when it writes one, and it writes one on
// any save: Beatport's "Techno (Peak Time / Driving)" came out "Techno ((Peak Time / Driving)".
// The old numeric form "(35)" has to survive too: it is how a v2.3 tag names House.
describe('a v2.3 genre through a TagLib save', () => {
  it.each([...GENRES, '(35)'])('"%s" comes back byte for byte', async (genre) => {
    const ffmpegMp3 = join(dir, `ff-${n++}.mp3`)
    execFileSync(FF, [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      tone,
      '-id3v2_version',
      '3',
      '-metadata',
      `genre=${genre}`,
      ffmpegMp3,
    ])
    const fromFlac = join(dir, `from-flac-${n++}.mp3`)
    copyFileSync(ffmpegMp3, fromFlac)
    copyCuesFromFlac(flacWithCues(), fromFlac)
    const mp3WithCues = join(dir, `cued-${n++}.mp3`)
    const tree = buildTraktorTree([traktorCue('Drop', 0, 1000, 0)])
    writeFileSync(mp3WithCues, Buffer.concat([id3WithPriv(tree), readFileSync(ffmpegMp3)]))
    const fromMp3 = join(dir, `from-mp3-${n++}.mp3`)
    copyFileSync(ffmpegMp3, fromMp3)
    copyCueFrames(mp3WithCues, fromMp3)
    const tagged = join(dir, `tagged-${n++}.mp3`)
    copyFileSync(ffmpegMp3, tagged)
    writeTags(tagged, { ...emptyMetadata(), title: 'T', genre: (await readTags(ffmpegMp3)).genre })
    expect([tconText(fromFlac), tconText(fromMp3), tconText(tagged)]).toEqual([genre, genre, genre])
  })
})
