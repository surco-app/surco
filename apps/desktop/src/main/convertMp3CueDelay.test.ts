import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

let traktorCueOffsetMs = 0
vi.mock('./settings', () => ({
  getSettings: () => ({ traktorNmlPath: '', traktorCueOffsetMs }),
}))

import type { TrackMetadata } from '../shared/types'
import { mp3TimingOfFile } from './cueCalibration'
import { convertAudio } from './ffmpeg'
import { leadingId3v2Size } from './id3Header'
import { readCueTree } from './tags'
import { buildTraktorTree, injectWavPriv, readTraktorCueStart, traktorCue } from './traktor4Fixture'

// Measured in Traktor Pro 4.5.1 on 31/10/2026 (see cueCalibration.ts): an MP3 with a
// Xing/LAME header draws 2257 samples later than the audio ffmpeg decodes from it, one
// without the header draws exactly what ffmpeg decodes. The converted file keeps what
// ffmpeg decoded, so only the first needs its cues moved.
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
let wav: string
let noisyCover: string

const XING_LEAD_MS = (2257 / 44100) * 1000

beforeAll(() => {
  const tree = buildTraktorTree([traktorCue('Intro', 0, CUE_START_MS, 1)])
  withXing = makeMp3('with-xing', true, tree)
  withoutXing = makeMp3('without-xing', false, tree)
  wav = join(dir, 'source.wav')
  execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=5', wav])
  injectWavPriv(wav, tree)
  noisyCover = join(dir, 'noise.png')
  execFileSync(FF, [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=gray:s=800x800,noise=alls=100:allf=t',
    '-frames:v',
    '1',
    noisyCover,
  ])
})

function cueStart(file: string): number {
  const tree = readCueTree(file)
  expect(tree).toBeDefined()
  return readTraktorCueStart(tree as Uint8Array, 0)
}

describe('Traktor cue calibration on the MP3 crossings', () => {
  it.each(['flac', 'aiff', 'wav'] as const)(
    'moves the cues of a Xing MP3 back by the Xing lead into %s',
    async (format) => {
      const out = join(dir, `from-xing.${format}`)
      await convertAudio(withXing, out, format, meta)

      expect(cueStart(out)).toBeCloseTo(CUE_START_MS - XING_LEAD_MS, 1)
    },
  )

  it.each(['flac', 'aiff', 'wav'] as const)(
    'leaves the cues of a header-less MP3 where they were into %s',
    async (format) => {
      const out = join(dir, `from-no-xing.${format}`)
      await convertAudio(withoutXing, out, format, meta)

      expect(cueStart(out)).toBeCloseTo(CUE_START_MS, 1)
    },
  )

  it('writes the Xing header on its own MP3 output and moves the cues forward by its lead', async () => {
    const out = join(dir, 'from-wav.mp3')
    await convertAudio(wav, out, 'mp3', meta)

    expect(await mp3TimingOfFile(out)).toEqual({
      sampleRate: 44100,
      headerSamples: 1152,
      gaplessDelay: 1105,
    })
    expect(cueStart(out)).toBeCloseTo(CUE_START_MS + XING_LEAD_MS, 1)
  })

  it('still finds its Xing header behind a cover larger than a megabyte', async () => {
    const out = join(dir, 'from-wav-covered.mp3')
    await convertAudio(wav, out, 'mp3', meta, noisyCover)

    expect(leadingId3v2Size(readFileSync(out))).toBeGreaterThan(1 << 20)
    expect(cueStart(out)).toBeCloseTo(CUE_START_MS + XING_LEAD_MS, 1)
  })
})

// The calibration answers "where does Traktor draw this marker after the codec change".
// It cannot answer "do this DJ's cues feel early in Traktor", which is a property of their
// ears and their rig, not of the file. So the offset is a setting they own, applied on top
// of the calibration rather than replacing it.
describe('the user cue offset setting', () => {
  afterAll(() => {
    traktorCueOffsetMs = 0
  })

  it('adds a negative offset to the Xing calibration', async () => {
    traktorCueOffsetMs = -51
    const out = join(dir, 'offset-xing.flac')
    await convertAudio(withXing, out, 'flac', meta)

    expect(cueStart(out)).toBeCloseTo(CUE_START_MS - XING_LEAD_MS - 51, 1)
  })

  it('applies the offset alone where the route needs no calibration', async () => {
    traktorCueOffsetMs = -51
    const out = join(dir, 'offset-no-xing.flac')
    await convertAudio(withoutXing, out, 'flac', meta)

    expect(cueStart(out)).toBeCloseTo(CUE_START_MS - 51, 1)
  })

  it('contributes nothing of its own at zero', async () => {
    traktorCueOffsetMs = 0
    const out = join(dir, 'offset-zero.flac')
    await convertAudio(withXing, out, 'flac', meta)

    expect(cueStart(out)).toBeCloseTo(CUE_START_MS - XING_LEAD_MS, 1)
  })
})
