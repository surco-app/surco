import { describe, expect, it } from 'vitest'
import {
  isRecoveryUrl,
  mediaMimeType,
  mediaPathFromUrl,
  mediaRecoveryUrl,
  mediaUrl,
  parseRange,
} from './media'

describe('media url round-trip', () => {
  // The whole point of the custom scheme is that one encoded URL survives the
  // trip to the renderer and back regardless of platform, so the paths that
  // break a naive `file://` + path concatenation are exactly what must hold.
  const cases = [
    '/Users/vicent/Music/track.wav',
    '/Users/vicent/Music/Artist - Title (Extended Mix).aiff',
    'C:\\Users\\Vicent\\Music\\Mi Tema #2.wav',
    '/Users/vicent/Música/Café del Mar.flac',
    '/Users/vicent/Music/a?b&c=d.mp3',
  ]

  for (const path of cases) {
    it(`preserves ${path}`, () => {
      expect(mediaPathFromUrl(mediaUrl(path))).toBe(path)
    })
  }
})

describe('recovery url', () => {
  // A damaged file makes Chromium's demuxer abort the element while ffmpeg decodes
  // past the corruption, so the retry has to tell main "serve me the repaired
  // transcode" — the flag must survive the round-trip without touching the path.
  it('marks the retry stream and still round-trips the path', () => {
    const url = mediaRecoveryUrl('/m/damaged.flac')
    expect(isRecoveryUrl(url)).toBe(true)
    expect(mediaPathFromUrl(url)).toBe('/m/damaged.flac')
  })

  it('does not mistake a plain stream, or a literal "?" in the path, for a retry', () => {
    expect(isRecoveryUrl(mediaUrl('/m/a.flac'))).toBe(false)
    expect(isRecoveryUrl(mediaUrl('/m/a?recover=1.mp3'))).toBe(false)
    expect(mediaPathFromUrl(mediaRecoveryUrl('/m/a?b&c=d.mp3'))).toBe('/m/a?b&c=d.mp3')
  })
})

describe('mediaMimeType', () => {
  it('maps audio extensions so the element can decode the stream', () => {
    expect(mediaMimeType('/x/a.mp3')).toBe('audio/mpeg')
    expect(mediaMimeType('/x/a.wav')).toBe('audio/wav')
    expect(mediaMimeType('/x/a.flac')).toBe('audio/flac')
    expect(mediaMimeType('/x/A.AIFF')).toBe('audio/aiff')
    expect(mediaMimeType('/x/a.aif')).toBe('audio/aiff')
  })

  it('falls back to octet-stream for the unknown', () => {
    expect(mediaMimeType('/x/a.xyz')).toBe('application/octet-stream')
  })
})

describe('parseRange', () => {
  // 1000-byte file, byte indices 0..999.
  it('returns null without a header, so the whole file is served', () => {
    expect(parseRange(null, 1000)).toBeNull()
  })

  it('reads an explicit start-end range', () => {
    expect(parseRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 })
  })

  it('defaults an open-ended range to the last byte', () => {
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 })
  })

  it('reads a suffix range as the final N bytes (how seeking near the end asks)', () => {
    expect(parseRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 })
  })

  it('clamps an end past the file to the last byte', () => {
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 })
  })

  it('rejects an unsatisfiable or malformed range', () => {
    expect(parseRange('bytes=2000-3000', 1000)).toBeNull()
    expect(parseRange('bytes=500-100', 1000)).toBeNull()
    expect(parseRange('weird', 1000)).toBeNull()
  })
})
