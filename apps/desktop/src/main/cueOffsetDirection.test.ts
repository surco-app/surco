import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

let traktorCueOffsetMs = 0
vi.mock('./settings', () => ({
  getSettings: () => ({ traktorNmlPath: '', traktorCueOffsetMs }),
}))

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'
import { readCueTree } from './tags'
import { buildTraktorTree, readTraktorCueStart, traktorCue } from './traktor4Fixture'

// The setting's sign reads the opposite way round to most people's first guess, because
// two negations sit between the box and the file: cueShiftFor subtracts the offset into
// shiftMs, and shiftTraktorCues then subtracts shiftMs from the stored position. Reading
// either line alone gives the wrong answer, which is how the direction was stated
// backwards in the UI and how the DJ this exists for ended up dialling the opposite sign
// to the one he wanted. This file pins the DIRECTION against a real conversion so the
// wording in Settings has something to be right about.
const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-cuedir-'))
const CUE_MS = 10000

const meta: TrackMetadata = {
  title: 'T',
  artist: 'A',
  album: '',
  albumArtist: '',
  year: '',
  genre: '',
  grouping: '',
  comment: '',
  trackNumber: '',
  discNumber: '',
  bpm: '128',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
}

function id3WithCue(tree: Uint8Array): Buffer {
  const owner = Buffer.from('TRAKTOR4\0', 'latin1')
  const body = Buffer.concat([owner, Buffer.from(tree)])
  const head = Buffer.alloc(10)
  head.write('PRIV', 0, 'latin1')
  head.writeUInt32BE(body.length, 4)
  const frames = Buffer.concat([head, body])
  const tag = Buffer.alloc(10)
  tag.write('ID3', 0, 'latin1')
  tag[3] = 3
  const size = frames.length
  tag[6] = (size >> 21) & 0x7f
  tag[7] = (size >> 14) & 0x7f
  tag[8] = (size >> 7) & 0x7f
  tag[9] = size & 0x7f
  return Buffer.concat([tag, frames])
}

let src: string

beforeAll(() => {
  const wav = join(dir, 's.wav')
  src = join(dir, 's.mp3')
  execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=20', wav])
  execFileSync(FF, ['-y', '-v', 'error', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '320k', src])
  writeFileSync(
    src,
    Buffer.concat([
      id3WithCue(buildTraktorTree([traktorCue('C', 0, CUE_MS, 1)])),
      readFileSync(src),
    ]),
  )
})

async function storedStart(offset: number): Promise<number> {
  traktorCueOffsetMs = offset
  try {
    const out = join(dir, `o${offset}.mp3`)
    await convertAudio(src, out, 'mp3', meta)
    return readTraktorCueStart(readCueTree(out) as Uint8Array, 0)
  } finally {
    traktorCueOffsetMs = 0
  }
}

describe('which way the cue offset moves a cue', () => {
  // Nearer the start of the track is sooner under the playhead, so this is the one the
  // Settings copy calls "earlier" (settings.traktorCueOffsetEarlier).
  it('a negative offset moves the cue toward the start of the track', async () => {
    expect(await storedStart(-51)).toBeCloseTo(CUE_MS - 51, 0)
  })

  it('a positive offset moves it further in', async () => {
    expect(await storedStart(51)).toBeCloseTo(CUE_MS + 51, 0)
  })

  it('leaves the cue alone at zero', async () => {
    expect(await storedStart(0)).toBeCloseTo(CUE_MS, 0)
  })
})
