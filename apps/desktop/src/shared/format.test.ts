import { describe, expect, it } from 'vitest'
import { formatExtension, formatMatchesInput } from './format'

describe('formatExtension', () => {
  // ALAC is the one format whose name is not its extension: it lives in an MPEG-4
  // container, so every filename the app builds or previews must say .m4a.
  it('maps ALAC to its m4a container and every other format to itself', () => {
    expect(formatExtension('alac')).toBe('m4a')
    expect(formatExtension('aiff')).toBe('aiff')
    expect(formatExtension('mp3')).toBe('mp3')
    expect(formatExtension('wav')).toBe('wav')
    expect(formatExtension('flac')).toBe('flac')
  })
})

describe('formatMatchesInput', () => {
  // An .m4a source may hold lossy AAC, not ALAC; calling it "already ALAC" would
  // rewrite the user's original in place with a re-encode. ALAC therefore never
  // matches its input, so the export always renders a fresh file.
  it('never treats an .m4a source as already being ALAC', () => {
    expect(formatMatchesInput('alac', '/music/song.m4a')).toBe(false)
    expect(formatMatchesInput('alac', '/music/song.alac')).toBe(false)
  })

  it('still matches the formats that own their extension', () => {
    expect(formatMatchesInput('mp3', '/music/song.MP3')).toBe(true)
    expect(formatMatchesInput('aiff', '/music/song.aif')).toBe(true)
  })
})
