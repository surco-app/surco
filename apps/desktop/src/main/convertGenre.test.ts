import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
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
import { buildTraktorTree, traktorCue } from './traktor4Fixture'
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

// Plex splits a genre on ';', so its users join several with "; ". ID3v2.3 has no list
// separator of its own and TagLib reads one into two values, then writes them back as
// the ID3v1 number of the first: the cue pass that carries a FLAC's Traktor cues over
// re-saved "House; Deep House" as "(35) Deep House", which every DJ tool shows as junk.
describe('convertAudio — a genre that holds several on ID3v2.3 targets', () => {
  it.each(
    (['mp3', 'aiff'] as OutputFormat[]).flatMap((format) =>
      ['House; Deep House', 'Drum & Bass / Jungle'].map((genre) => [format, genre] as const),
    ),
  )(
    'a FLAC with Traktor cues converted to %s keeps the genre "%s" as written',
    async (format, genre) => {
      const meta = { ...emptyMetadata(), title: 'T', genre }
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
