import { describe, expect, it } from 'vitest'
import { isMissingInputError } from './missingInput'

describe('isMissingInputError', () => {
  // A track the user moved or renamed in Finder, or one a conversion replaced, is the
  // ordinary case this exists for — not a damaged file. ffprobe reports it on stderr and
  // exits non-zero, which is otherwise indistinguishable from "this audio is broken".
  it('recognises ffprobe reporting the input is not there', () => {
    const err = Object.assign(new Error('Command failed'), {
      stderr: '/Users/dj/Desktop/Track.flac: No such file or directory\n',
    })

    expect(isMissingInputError(err)).toBe(true)
  })

  // ffmpeg phrases the same condition differently depending on the demuxer and locale
  // path it took, so matching only ffprobe's wording would let the other spelling
  // through and keep blaming the audio.
  it('recognises the ENOENT spelling too', () => {
    const err = Object.assign(new Error('Command failed'), {
      stderr: 'Error opening input: ENOENT (No such file or directory)\n',
    })

    expect(isMissingInputError(err)).toBe(true)
  })

  // The guard must stay narrow: a genuinely corrupt file has to keep its own ffmpeg
  // stderr, which says far more in a bug report than a generic sentence would.
  it('leaves a real decode failure alone', () => {
    const err = Object.assign(new Error('Command failed'), {
      stderr: '[flac @ 0x14f] Invalid data found when processing input\n',
    })

    expect(isMissingInputError(err)).toBe(false)
  })

  it('is false for an error carrying no stderr at all', () => {
    expect(isMissingInputError(new Error('boom'))).toBe(false)
    expect(isMissingInputError(undefined)).toBe(false)
  })
})
