import { describe, expect, it } from 'vitest'
import { fileExtension, formatFileSize } from './properties'

describe('fileExtension', () => {
  it('reads the real extension off the source path, uppercased', () => {
    expect(fileExtension('/music/bases buenas/20. Dj Isaac - On The Edge.flac')).toBe('FLAC')
    expect(fileExtension('/x/song.mp3')).toBe('MP3')
  })

  // The Properties panel took the extension from the parsed file NAME, which has already
  // dropped its extension AND carries a track-number dot ("20. Title"): splitting on '.'
  // there returned the title in caps as the "extension". The real path is the only place
  // the true container lives, so a dotted title never masquerades as a format again.
  it('ignores dots in the file body — a track-number prefix is not an extension', () => {
    expect(fileExtension('/x/20. Dj Isaac - On The Edge (Original Mix).flac')).toBe('FLAC')
  })

  it('is empty when the path has no extension', () => {
    expect(fileExtension('/x/song')).toBe('')
    expect(fileExtension('')).toBe('')
  })
})

describe('formatFileSize', () => {
  it('keeps raw bytes below a kilobyte', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(512)).toBe('512 B')
  })

  it('rounds to whole kilobytes up to a megabyte', () => {
    expect(formatFileSize(1024)).toBe('1 KB')
    // The 321 KB tag Meta shows for a stripped WAV header
    expect(formatFileSize(328_704)).toBe('321 KB')
  })

  it('shows one decimal for megabytes', () => {
    expect(formatFileSize(58_400_000)).toBe('55.7 MB')
  })

  it('shows two decimals for gigabytes', () => {
    expect(formatFileSize(2_000_000_000)).toBe('1.86 GB')
  })

  it('returns an empty string for an unreadable size', () => {
    // A failed stat leaves the row blank rather than printing "NaN B".
    expect(formatFileSize(Number.NaN)).toBe('')
    expect(formatFileSize(-1)).toBe('')
  })
})
