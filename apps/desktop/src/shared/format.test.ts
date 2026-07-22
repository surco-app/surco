import { describe, expect, it } from 'vitest'
import { editsInPlace, formatExtension, formatMatchesInput, resolveJobFormat } from './format'

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

describe('editsInPlace', () => {
  it('edits in place when the target format is the one the file is already in', () => {
    expect(editsInPlace('wav', '/music/song.wav')).toBe(true)
    expect(editsInPlace('mp3', '/music/song.wav')).toBe(false)
  })

  it('overwrite mode forces in place across formats', () => {
    expect(editsInPlace('aiff', '/music/song.wav', true)).toBe(true)
  })

  // ALAC keeps its never-in-place invariant even under overwrite: the .m4a source may
  // hold lossy AAC, and replacing it would destroy the only true copy while presenting
  // a lossy re-encode as lossless. An ALAC export always renders a fresh file.
  it('never lets overwrite mode force ALAC in place', () => {
    expect(editsInPlace('alac', '/music/song.m4a', true)).toBe(false)
    expect(editsInPlace('alac', '/music/song.wav', true)).toBe(false)
  })
})

describe('resolveJobFormat', () => {
  // "Same as source" is a rule for picking a format, not a format: the job that
  // reaches the main process must always name a real one, or ffmpeg's format chain
  // falls through to AIFF and silently rewrites the user's file as something else.
  it('resolves each supported extension to its own format', () => {
    expect(resolveJobFormat('source', '/music/song.mp3', 'aiff')).toBe('mp3')
    expect(resolveJobFormat('source', '/music/song.wav', 'aiff')).toBe('wav')
    expect(resolveJobFormat('source', '/music/song.flac', 'aiff')).toBe('flac')
    expect(resolveJobFormat('source', '/music/song.aiff', 'aiff')).toBe('aiff')
  })

  // .aif rips are as common as .aiff and must keep their own format rather than
  // falling back — the existing exportedFormat in Editor.tsx gets this wrong.
  it('resolves .aif to aiff', () => {
    expect(resolveJobFormat('source', '/music/song.aif', 'mp3')).toBe('aiff')
  })

  // An .m4a may hold lossy AAC, not ALAC. Calling it "already ALAC" would let an
  // overwrite re-encode the user's only copy and present it as lossless.
  it('never resolves .m4a to alac', () => {
    expect(resolveJobFormat('source', '/music/song.m4a', 'aiff')).toBe('aiff')
  })

  // Surco imports more extensions than it can export; these always transcoded and
  // still do, rather than blocking the file.
  it('falls back for inputs with no matching output format', () => {
    expect(resolveJobFormat('source', '/music/song.opus', 'aiff')).toBe('aiff')
    expect(resolveJobFormat('source', '/music/song.ogg', 'wav')).toBe('wav')
    expect(resolveJobFormat('source', '/music/song.aac', 'aiff')).toBe('aiff')
    expect(resolveJobFormat('source', '/music/no-extension', 'aiff')).toBe('aiff')
  })

  // A pinned format is the user overriding the rule; the source file has no say.
  it('returns a concrete setting untouched', () => {
    expect(resolveJobFormat('mp3', '/music/song.flac', 'aiff')).toBe('mp3')
    expect(resolveJobFormat('alac', '/music/song.m4a', 'aiff')).toBe('alac')
  })
})
