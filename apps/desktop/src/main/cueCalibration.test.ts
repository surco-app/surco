import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it } from 'vitest'
import { automaticCueOffsetMs, automaticCueOffsetOfFiles } from './cueCalibration'
import { leadingId3v2Size } from './id3Header'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-cue-calibration-'))

const XING_FRAME = 1152
const ENCODER_DELAY = 1105
const ms = (samples: number, rate: number) => (samples / rate) * 1000

const xing44 = { xing: true, sampleRate: 44100 }
const xing48 = { xing: true, sampleRate: 48000 }
const bare44 = { xing: false, sampleRate: 44100 }
const bare48 = { xing: false, sampleRate: 48000 }

function encode(name: string, args: string[]): string {
  const out = join(dir, name)
  execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=1', ...args, out])
  return out
}

// Measured in Traktor Pro 4.5.1 on 31/10/2026 with one click track encoded five ways: WAV,
// AIFF and FLAC share a timeline to the microsecond, an MP3 with a Xing/LAME header draws
// 51.14 ms later and one without it 24.88 ms later. Traktor plays the Xing frame as 1152
// samples of silence and keeps the 1105-sample encoder delay; ffmpeg skips both when the
// header is there and neither when it is not, and the converted file keeps what ffmpeg
// decoded. The cue has to land on the same audio in the output as it marked in the source.
describe('automatic Traktor codec cue calibration', () => {
  it('moves a cue earlier out of a Xing MP3 into PCM, since ffmpeg drops the frame and delay Traktor draws', () => {
    expect(automaticCueOffsetMs(xing44, null)).toBeCloseTo(-ms(XING_FRAME + ENCODER_DELAY, 44100))
    expect(automaticCueOffsetMs(xing44, null)).toBeCloseTo(-51.18, 2)
  })

  it('counts the samples at the MP3 own rate, so a 48 kHz file is not corrected as if it were 44.1', () => {
    expect(automaticCueOffsetMs(xing48, null)).toBeCloseTo(-ms(XING_FRAME + ENCODER_DELAY, 48000))
  })

  it('leaves a header-less MP3 into PCM alone, because the delay Traktor draws is decoded into the output too', () => {
    expect(automaticCueOffsetMs(bare44, null)).toBe(0)
    expect(automaticCueOffsetMs(bare48, null)).toBe(0)
  })

  it('moves a cue later into an MP3 by what Traktor draws ahead of the encoded audio', () => {
    expect(automaticCueOffsetMs(null, xing44)).toBeCloseTo(ms(XING_FRAME + ENCODER_DELAY, 44100))
    expect(automaticCueOffsetMs(null, xing48)).toBeCloseTo(ms(XING_FRAME + ENCODER_DELAY, 48000))
    expect(automaticCueOffsetMs(null, bare44)).toBeCloseTo(ms(ENCODER_DELAY, 44100))
  })

  it('does not move a re-encode between two Xing MP3s', () => {
    expect(automaticCueOffsetMs(xing44, xing44)).toBe(0)
  })

  it('moves a header-less MP3 re-encoded with a header by the whole Xing lead, its delay being baked into the audio', () => {
    expect(automaticCueOffsetMs(bare44, xing44)).toBeCloseTo(ms(XING_FRAME + ENCODER_DELAY, 44100))
  })

  it('takes each side at its own rate across a resample', () => {
    expect(automaticCueOffsetMs(xing44, xing48)).toBeCloseTo(
      ms(XING_FRAME + ENCODER_DELAY, 48000) - ms(XING_FRAME + ENCODER_DELAY, 44100),
    )
  })

  it('does not move PCM to PCM', () => {
    expect(automaticCueOffsetMs(null, null)).toBe(0)
  })
})

describe('automaticCueOffsetOfFiles', () => {
  it('reads the Xing header and the rate off the source file', async () => {
    const wav = encode('pcm.wav', [])
    const withXing = encode('xing48.mp3', ['-ar', '48000', '-c:a', 'libmp3lame'])
    const withoutXing = encode('bare.mp3', ['-c:a', 'libmp3lame', '-write_xing', '0'])

    expect(await automaticCueOffsetOfFiles(withXing, wav)).toBeCloseTo(
      -ms(XING_FRAME + ENCODER_DELAY, 48000),
    )
    expect(await automaticCueOffsetOfFiles(withoutXing, wav)).toBe(0)
  })

  it('reads the output MP3 header the same way', async () => {
    const flac = encode('pcm.flac', [])
    const withoutXing = encode('bare-out.mp3', ['-c:a', 'libmp3lame', '-write_xing', '0'])

    expect(await automaticCueOffsetOfFiles(flac, withoutXing)).toBeCloseTo(ms(ENCODER_DELAY, 44100))
  })
})

describe('automaticCueOffsetOfFiles past a large cover', () => {
  it('finds the Xing header behind an ID3 tag bigger than the bytes it used to scan', async () => {
    const cover = join(dir, 'noise.png')
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
      cover,
    ])
    const wav = encode('plain.wav', [])
    const covered = join(dir, 'covered.mp3')
    execFileSync(FF, [
      '-y',
      '-v',
      'error',
      '-i',
      wav,
      '-i',
      cover,
      '-map',
      '0:a',
      '-map',
      '1:v',
      '-c:a',
      'libmp3lame',
      '-c:v',
      'copy',
      '-disposition:v',
      'attached_pic',
      covered,
    ])
    expect(leadingId3v2Size(readFileSync(covered))).toBeGreaterThan(1 << 20)

    expect(await automaticCueOffsetOfFiles(covered, wav)).toBeCloseTo(
      -ms(XING_FRAME + ENCODER_DELAY, 44100),
    )
    expect(await automaticCueOffsetOfFiles(wav, covered)).toBeCloseTo(
      ms(XING_FRAME + ENCODER_DELAY, 44100),
    )
  })
})
