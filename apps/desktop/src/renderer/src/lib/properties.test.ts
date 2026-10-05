import { describe, expect, it } from 'vitest'
import type { TrackProperties } from '../../../shared/types'
import { audioSummaryParts, fileExtension, formatFileSize, libraryCopyFormat } from './properties'

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
    expect(formatFileSize(0, 'en')).toBe('0 B')
    expect(formatFileSize(512, 'en')).toBe('512 B')
  })

  it('rounds to whole kilobytes up to a megabyte', () => {
    expect(formatFileSize(1024, 'en')).toBe('1 KB')
    // The 321 KB tag Meta shows for a stripped WAV header
    expect(formatFileSize(328_704, 'en')).toBe('321 KB')
  })

  it('shows one decimal for megabytes', () => {
    expect(formatFileSize(58_400_000, 'en')).toBe('55.7 MB')
  })

  it('shows two decimals for gigabytes', () => {
    expect(formatFileSize(2_000_000_000, 'en')).toBe('1.86 GB')
  })

  it('writes the decimal mark of the app language, so Spanish reads 165,8 MB and not 165.8', () => {
    expect(formatFileSize(173_853_491, 'es')).toBe('165,8 MB')
    expect(formatFileSize(2_000_000_000, 'de')).toBe('1,86 GB')
  })

  it('keeps the trailing zero so sizes in a column stay the same width', () => {
    expect(formatFileSize(1024 * 1024, 'es')).toBe('1,0 MB')
  })

  it('returns an empty string for an unreadable size', () => {
    // A failed stat leaves the row blank rather than printing "NaN B".
    expect(formatFileSize(Number.NaN, 'en')).toBe('')
    expect(formatFileSize(-1, 'en')).toBe('')
  })
})

describe('audioSummaryParts', () => {
  const alac: TrackProperties = {
    container: 'mov',
    codec: 'alac',
    sampleRateHz: 44100,
    bitDepth: 16,
    channels: 2,
    bitrateKbps: 900,
    sizeBytes: 30_000_000,
    createdMs: null,
    modifiedMs: null,
    tagFormats: [],
  }
  const tr = (key: string): string => key

  // ffprobe names the container family, so an ALAC .m4a read as "MOV" beside a verdict
  // that calls the same file M4A. The format is the file's extension everywhere.
  it('names the format by the file extension, not the probed container family', () => {
    expect(audioSummaryParts(alac, '/music/Track.m4a', tr, 'en')[0]).toBe('M4A')
  })

  it('writes the sample rate with the decimal mark of the app language', () => {
    expect(audioSummaryParts(alac, '/music/Track.m4a', tr, 'es')[1]).toBe('44,1 kHz')
  })
})

describe('libraryCopyFormat', () => {
  const probe = (over: Partial<TrackProperties>): TrackProperties => ({
    container: '',
    codec: '',
    sampleRateHz: 44100,
    bitDepth: null,
    channels: 2,
    bitrateKbps: null,
    sizeBytes: 0,
    createdMs: null,
    modifiedMs: null,
    tagFormats: [],
    ...over,
  })

  // Whether to replace a library copy with a better rip hinges on how good the copy is: an
  // MP3 at 128 is worth replacing, one at 320 maybe not. A lossy file's quality is its bitrate.
  it('names a lossy copy by format and bitrate', () => {
    expect(libraryCopyFormat(probe({ codec: 'mp3', bitrateKbps: 320 }), '/m/a.mp3', 'en')).toBe(
      'MP3 320',
    )
  })

  // An .m4a holds AAC or ALAC and the extension cannot say which, yet that is the whole
  // difference between a lossy copy and a lossless one. The probed codec decides.
  it('tells AAC from ALAC inside an .m4a by the probed codec', () => {
    expect(libraryCopyFormat(probe({ codec: 'aac', bitrateKbps: 256 }), '/m/a.m4a', 'en')).toBe(
      'AAC 256',
    )
    expect(
      libraryCopyFormat(probe({ codec: 'alac', bitDepth: 16, bitrateKbps: 900 }), '/m/a.m4a', 'en'),
    ).toBe('ALAC 16/44.1')
  })

  // A lossless copy's bitrate only measures how well it compressed; its resolution is what
  // a better rip could beat.
  it('names a lossless copy by bit depth and sample rate', () => {
    expect(
      libraryCopyFormat(
        probe({ codec: 'pcm_s24be', bitDepth: 24, sampleRateHz: 96000, bitrateKbps: 4608 }),
        '/m/a.aiff',
        'es',
      ),
    ).toBe('AIFF 24/96')
    expect(libraryCopyFormat(probe({ codec: 'pcm_s16le', bitDepth: 16 }), '/m/a.wav', 'es')).toBe(
      'WAV 16/44,1',
    )
  })

  it('falls back to the bare format when the probe read no quality figure', () => {
    expect(libraryCopyFormat(probe({ codec: 'mp3' }), '/m/a.mp3', 'en')).toBe('MP3')
  })
})
