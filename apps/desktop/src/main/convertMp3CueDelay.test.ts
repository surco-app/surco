import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'
import { readCueTree } from './tags'
import { buildTraktorTree, readTraktorCueStart, traktorCue } from './traktor4Fixture'

// The bug this file pins, measured on 2026-09-06 with an impulse train through the
// bundled ffmpeg: converting an MP3 that has no Xing/LAME header shifts every sample
// 1105 later (25.06 ms), because that header is what tells the decoder to drop the
// encoder's priming samples. Cues carried onto the output keep their old timestamps
// and so land 25 ms early relative to the audio — the "cues no longer match the grid"
// the user reported. An MP3 that still has its header decodes sample-aligned and must
// not be touched at all.
const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-mp3delay-'))

const CUE_START_MS = 2000

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

// A PRIV frame is the shape Traktor uses for cues on MP3, and the one shiftTraktorCues
// parses directly (see tags.ts). Written raw so the conversion clones a real on-disk
// layout rather than something TagLib re-serialized.
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

function makeMp3(name: string, writeXing: boolean, tree: Uint8Array): string {
  const wav = join(dir, `${name}.wav`)
  const mp3 = join(dir, `${name}.mp3`)
  execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=5', wav])
  const args = ['-y', '-v', 'error', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '320k']
  if (!writeXing) args.push('-write_xing', '0')
  execFileSync(FF, [...args, mp3])
  writeFileSync(mp3, Buffer.concat([id3WithCue(tree), readFileSync(mp3)]))
  return mp3
}

let withXing: string
let withoutXing: string

beforeAll(() => {
  const tree = buildTraktorTree([traktorCue('Intro', 0, CUE_START_MS, 1)])
  withXing = makeMp3('with-xing', true, tree)
  withoutXing = makeMp3('without-xing', false, tree)
})

describe('MP3 encoder delay compensation on conversion', () => {
  // The file that decodes sample-aligned. Compensating here would move a cue the
  // user placed correctly, which is how AudioFinder's fixed -51 ms goes wrong: it
  // shifts this case too.
  it('leaves cues untouched when the source MP3 carries its Xing header', async () => {
    const out = join(dir, 'from-xing.flac')
    await convertAudio(withXing, out, 'flac', meta)

    const tree = readCueTree(out)
    expect(tree).toBeDefined()
    expect(readTraktorCueStart(tree as Uint8Array, 0)).toBeCloseTo(CUE_START_MS, 0)
  })

  // The reported case: without the header the audio arrives 25.06 ms late, so the cue
  // has to move the same amount to stay on the same beat.
  it('pushes cues by the encoder delay when the source MP3 has no Xing header', async () => {
    const out = join(dir, 'from-no-xing.flac')
    await convertAudio(withoutXing, out, 'flac', meta)

    const tree = readCueTree(out)
    expect(tree).toBeDefined()
    expect(readTraktorCueStart(tree as Uint8Array, 0)).toBeCloseTo(CUE_START_MS + 25.06, 1)
  })
})
