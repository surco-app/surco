import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { firstErrorLine } from './ffmpeg'

// The detail this picks is the entire description of WHY a conversion was refused that
// reaches a user's bug report, and the two ffmpeg builds Surco ships do not agree on the
// shape of a failed decode. 6.0 (what ffmpeg-static gives macOS) stops at the decoder's
// complaint; 6.1.1 (Linux and, per the same package, Windows) keeps going and prints a
// bracket-tagged end-of-run summary AFTER it. Taking the last tagged line therefore
// reported a byte count as the diagnosis on the platform most users are on.
//
// Both are captured verbatim from a real run on the mid-corrupted MP3 fixture, so this
// pins the choice against the output instead of against whichever binary the test host
// happens to have.
describe('firstErrorLine', () => {
  const banner = [
    '[mp3 @ 0x155006ae0] filesize and duration do not match (growing file?)',
    "Input #0, mp3, from 'midcorrupt.mp3':",
    '  Metadata:',
    '    encoder         : Lavf60.3.100',
    '  Duration: 00:00:08.05, start: 0.025057, bitrate: 51 kb/s',
    '  Stream #0:0: Audio: mp3, 44100 Hz, mono, fltp, 64 kb/s',
    'Stream mapping:',
    '  Stream #0:0 -> #0:0 (mp3 (mp3float) -> pcm_s16le (native))',
    'Press [q] to stop, [?] for help',
    "Output #0, null, to 'pipe:':",
  ]

  it('reports the decoder failure on the build that stops at it', () => {
    const stderr = [
      ...banner,
      '[mp3float @ 0x15500bd00] Header missing',
      'Conversion failed!',
    ].join('\n')
    expect(firstErrorLine(stderr)).toMatch(/Header missing/)
  })

  it('reports the decoder failure, not the summary ffmpeg prints after it', () => {
    const stderr = [
      ...banner,
      '[mp3float @ 0x1da01234] Header missing',
      '[out#0/null @ 0x1da02340] video:0KiB audio:83KiB subtitle:0KiB other streams:0KiB global headers:0KiB muxing overhead: unknown',
      'Conversion failed!',
    ].join('\n')

    const line = firstErrorLine(stderr)
    expect(line, 'reported the byte-count summary instead of the cause').not.toMatch(
      /muxing overhead/,
    )
    expect(line).toMatch(/Header missing/)
  })

  // The fallbacks still have to hold: a build that names no component at all must
  // report something rather than an empty string the user's report cannot act on.
  it('falls back to the last real line when nothing is tagged', () => {
    expect(firstErrorLine('Conversion failed!')).toBe('Conversion failed!')
  })
})
