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
  // The audio needs no correction here — with its header the MP3 decodes sample-aligned,
  // measured. What moves the cue is the DJ's directional calibration (10/09/2026): he
  // watched Traktor place the marker 51 ms out coming out of MP3, which is about where
  // Traktor DRAWS it, not where the audio sits. See cueCalibration.ts.
  it('applies the directional calibration to a Xing-carrying MP3', async () => {
    const out = join(dir, 'from-xing.flac')
    await convertAudio(withXing, out, 'flac', meta)

    const tree = readCueTree(out)
    expect(tree).toBeDefined()
    expect(readTraktorCueStart(tree as Uint8Array, 0)).toBeCloseTo(CUE_START_MS - 51, 0)
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

// Reported 10/09/2026 by the DJ, converting and checking in Traktor: the marker lands
// 51 ms out in one direction going into MP3 and the other coming out of it. That is a
// property of where TRAKTOR draws the marker, which no measurement of the audio here can
// confirm or deny — the click stays on its sample through every one of these conversions.
// He has Traktor in front of him and we do not, so the calibration is his.
//
// What this file does own is that a file never receives two corrections for the same
// drift. The Xing fix and the calibration are both "the codec moved things", so they
// REPLACE each other rather than stacking: an MP3 whose header was stripped already
// decodes 25.06 ms late and gets that exact figure, not that plus another 51.
describe('the directional calibration against the codec fix', () => {
  afterAll(() => {
    traktorCueOffsetMs = 0
  })

  // The case his own testing cannot reach: a stripped-header MP3 is a rip or an edit, not
  // a file a normal encode produces. Stacking would put it 76 ms out, so the larger,
  // measured correction wins and the calibration steps aside.
  it('does not add the calibration on top of the encoder-delay fix', async () => {
    const out = join(dir, 'calibrated-no-xing.flac')
    await convertAudio(withoutXing, out, 'flac', meta)

    const tree = readCueTree(out)
    expect(tree).toBeDefined()
    expect(readTraktorCueStart(tree as Uint8Array, 0)).toBeCloseTo(CUE_START_MS + 25.06, 1)
  })

  // An MP3 that still carries its header decodes sample-aligned, so there is no measured
  // drift to preserve and the calibration is the only correction. This is the path he
  // actually tested, and it has to keep behaving the way he saw it.
  it('applies the calibration when there is no encoder delay to correct', async () => {
    const out = join(dir, 'calibrated-xing.flac')
    await convertAudio(withXing, out, 'flac', meta)

    const tree = readCueTree(out)
    expect(tree).toBeDefined()
    expect(readTraktorCueStart(tree as Uint8Array, 0)).toBeCloseTo(CUE_START_MS - 51, 0)
  })
})

// The measured compensation above answers "did the conversion move the audio". It cannot
// answer "do this DJ's cues feel early in Traktor", which is a property of their ears and
// their rig, not of the file — one reporter runs AudioFinder's fixed -51 ms and finds it
// right. So the offset is a setting they own, applied on top of the measured correction
// rather than replacing it: the codec fix keeps working on the files that need it, and
// the taste adjustment moves every cue by the same amount whatever the source.
describe('the user cue offset setting', () => {
  afterAll(() => {
    traktorCueOffsetMs = 0
  })

  // A negative value delays the cue, matching how a DJ describes it: "my cues hit early,
  // push them back".
  it('applies a negative offset on top of a source that needs no codec fix', async () => {
    traktorCueOffsetMs = -51
    const out = join(dir, 'offset-xing.flac')
    await convertAudio(withXing, out, 'flac', meta)

    const tree = readCueTree(out)
    // The route's own calibration (-51) plus the slider's -51.
    expect(readTraktorCueStart(tree as Uint8Array, 0)).toBeCloseTo(CUE_START_MS - 102, 0)
  })

  // The slider stacks on whatever the route already corrects — here the 25.06 ms the
  // missing Xing header costs. Replacing one with the other is what makes a fixed offset
  // wrong. (The directional calibration steps aside for this file: see the suite below.)
  it('adds the offset to the encoder delay compensation, not instead of it', async () => {
    traktorCueOffsetMs = -51
    const out = join(dir, 'offset-no-xing.flac')
    await convertAudio(withoutXing, out, 'flac', meta)

    const tree = readCueTree(out)
    expect(readTraktorCueStart(tree as Uint8Array, 0)).toBeCloseTo(CUE_START_MS + 25.06 - 51, 0)
  })

  // The default: the SLIDER contributes nothing of its own. The cue still moves by the
  // route's calibration, which is not this setting's doing — a DJ who never opened
  // Settings gets exactly what the codec correction says and nothing else.
  it('contributes nothing of its own at zero', async () => {
    traktorCueOffsetMs = 0
    const out = join(dir, 'offset-zero.flac')
    await convertAudio(withXing, out, 'flac', meta)

    const tree = readCueTree(out)
    expect(readTraktorCueStart(tree as Uint8Array, 0)).toBeCloseTo(CUE_START_MS - 51, 0)
  })
})
