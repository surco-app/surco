import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MP3_ENCODER_DELAY_MS, mp3DecoderPadsHead } from './mp3EncoderDelay'

// Measured on 2026-09-06 against the bundled ffmpeg with an impulse train at 1/2/3 s:
// an MP3 carrying a Xing/LAME header decodes sample-aligned with the source, while the
// same audio encoded with -write_xing 0 comes back 1105 samples (25.06 ms) late — the
// encoder delay ffmpeg can no longer subtract once the header is gone. Traktor cues
// copied onto that output are off by exactly that much, which is the user-visible bug.
// The fixtures are built here rather than committed so the numbers stay tied to the
// binary that actually ships.
const ffmpeg = ffmpegPath as unknown as string

describe('mp3DecoderPadsHead', () => {
  let dir: string
  let withXing: string
  let withoutXing: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'surco-xing-'))
    const wav = join(dir, 'src.wav')
    withXing = join(dir, 'with-xing.mp3')
    withoutXing = join(dir, 'without-xing.mp3')
    execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=2', wav])
    execFileSync(ffmpeg, ['-y', '-v', 'error', '-i', wav, '-c:a', 'libmp3lame', withXing])
    execFileSync(ffmpeg, [
      '-y',
      '-v',
      'error',
      '-i',
      wav,
      '-c:a',
      'libmp3lame',
      '-write_xing',
      '0',
      withoutXing,
    ])
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  // The header is what lets the decoder drop the priming samples, so its presence is
  // the whole question: with it the output needs no cue compensation at all.
  it('reports no padding for an MP3 that carries the Xing/LAME header', () => {
    expect(mp3DecoderPadsHead(withXing)).toBe(false)
  })

  // Rips, cuts and tag editors routinely strip the header. Those are the files whose
  // cues land 25 ms late today.
  it('reports padding for an MP3 whose Xing/LAME header was stripped', () => {
    expect(mp3DecoderPadsHead(withoutXing)).toBe(true)
  })

  // A non-MP3 source never carries this delay: FLAC, WAV and AIFF decode as stored.
  it('reports no padding for a source that is not an MP3', () => {
    const wav = join(dir, 'src.wav')
    expect(mp3DecoderPadsHead(wav)).toBe(false)
  })

  // A path that cannot be read must not claim padding: shifting cues on a guess is
  // worse than leaving them where the user put them.
  it('reports no padding when the file cannot be read', () => {
    expect(mp3DecoderPadsHead(join(dir, 'missing.mp3'))).toBe(false)
  })

  it('exposes the measured encoder delay in milliseconds', () => {
    expect(MP3_ENCODER_DELAY_MS).toBeCloseTo(25.06, 2)
  })
})
