import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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

const xing44 = { sampleRate: 44100, headerSamples: XING_FRAME, gaplessDelay: ENCODER_DELAY }
const xing48 = { sampleRate: 48000, headerSamples: XING_FRAME, gaplessDelay: ENCODER_DELAY }
const bare44 = { sampleRate: 44100, headerSamples: 0, gaplessDelay: null }
const bare48 = { sampleRate: 48000, headerSamples: 0, gaplessDelay: null }
const unsigned44 = { sampleRate: 44100, headerSamples: XING_FRAME, gaplessDelay: null }

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

  it('moves a cue out of an Info frame with no encoder signature by that frame alone, since ffmpeg then keeps the delay', () => {
    expect(automaticCueOffsetMs(unsigned44, null)).toBeCloseTo(-ms(XING_FRAME, 44100))
  })

  it('takes the delay the encoder wrote into its tag rather than a fixed one', () => {
    const late = { sampleRate: 44100, headerSamples: XING_FRAME, gaplessDelay: 1000 + 529 }
    expect(automaticCueOffsetMs(late, null)).toBeCloseTo(-ms(XING_FRAME + 1000 + 529, 44100))
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

  it('reads an Info tag whose encoder signature ffmpeg does not trust as the frame alone', async () => {
    const wav = encode('unsigned.wav', [])
    const signed = encode('signed.mp3', ['-c:a', 'libmp3lame'])
    const bytes = readFileSync(signed)
    bytes.write('XXXX', bytes.indexOf('Lavc'), 'latin1')
    const unsigned = join(dir, 'unsigned.mp3')
    writeFileSync(unsigned, bytes)

    expect(await automaticCueOffsetOfFiles(unsigned, wav)).toBeCloseTo(-ms(XING_FRAME, 44100))
  })

  it('reads the delay out of the encoder tag', async () => {
    const wav = encode('late.wav', [])
    const bytes = readFileSync(encode('late-signed.mp3', ['-c:a', 'libmp3lame']))
    const at = bytes.indexOf('Lavc')
    bytes[at + 21] = 1000 >> 4
    bytes[at + 22] = ((1000 & 0x0f) << 4) | (bytes[at + 22] & 0x0f)
    const late = join(dir, 'late.mp3')
    writeFileSync(late, bytes)

    expect(await automaticCueOffsetOfFiles(late, wav)).toBeCloseTo(
      -ms(XING_FRAME + 1000 + 529, 44100),
    )
  })

  it('finds the header frame past junk that fakes a sync, and like ffmpeg trims no delay there', async () => {
    const wav = encode('junk.wav', [])
    const clean = readFileSync(encode('junk-clean.mp3', ['-c:a', 'libmp3lame']))
    const tagEnd = leadingId3v2Size(clean)
    const junk = Buffer.alloc(200)
    Buffer.from([0xff, 0xfb, 0x90, 0x44]).copy(junk)
    const junky = join(dir, 'junky.mp3')
    writeFileSync(junky, Buffer.concat([clean.subarray(0, tagEnd), junk, clean.subarray(tagEnd)]))

    expect(await automaticCueOffsetOfFiles(junky, wav)).toBeCloseTo(-ms(XING_FRAME, 44100))
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

function firstClick(file: string): number {
  const pcm = execFileSync(FF, ['-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-'], {
    maxBuffer: 1 << 26,
  })
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2)
  return samples.findIndex((s) => Math.abs(s) > 3000)
}

// The premise the rule stands on: what ffmpeg drops from the start of an MP3, which is what
// the converted file is missing compared with what Traktor draws.
describe('what ffmpeg drops from the start of an MP3', () => {
  const click = () => {
    const out = join(dir, 'click.wav')
    execFileSync(FF, [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      "aevalsrc='if(between(t,1,1.002),0.9,0)':d=2:s=44100",
      out,
    ])
    return out
  }

  it('drops the header frame and the signed delay, only the frame when unsigned or not right after the tag, nothing without one', () => {
    const wav = click()
    const mp3 = (name: string, args: string[]) => {
      const out = join(dir, name)
      execFileSync(FF, ['-y', '-v', 'error', '-i', wav, '-c:a', 'libmp3lame', ...args, out])
      return out
    }
    const signed = mp3('click-signed.mp3', [])
    const bare = mp3('click-bare.mp3', ['-write_xing', '0'])
    const bytes = readFileSync(signed)
    bytes.write('XXXX', bytes.indexOf('Lavc'), 'latin1')
    const unsigned = join(dir, 'click-unsigned.mp3')
    writeFileSync(unsigned, bytes)

    const tagEnd = leadingId3v2Size(bytes)
    const junky = join(dir, 'click-junky.mp3')
    const clean = readFileSync(signed)
    writeFileSync(
      junky,
      Buffer.concat([clean.subarray(0, tagEnd), Buffer.alloc(200), clean.subarray(tagEnd)]),
    )

    const at = firstClick(wav)
    expect(Math.abs(firstClick(signed) - at)).toBeLessThanOrEqual(2)
    expect(Math.abs(firstClick(bare) - (at + ENCODER_DELAY))).toBeLessThanOrEqual(2)
    expect(Math.abs(firstClick(unsigned) - (at + ENCODER_DELAY))).toBeLessThanOrEqual(2)
    expect(Math.abs(firstClick(junky) - (at + ENCODER_DELAY))).toBeLessThanOrEqual(2)
  })
})
