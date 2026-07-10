import { describe, expect, it } from 'vitest'
import { librarySourceOf } from './librarySource'

const base = {
  addToAppleMusic: false,
  addToEngineDj: false,
  overwriteOriginal: false,
  convertBesideOriginal: false,
  outputFormat: 'aiff' as const,
}

describe('librarySourceOf', () => {
  it('follows the conversion destination', () => {
    expect(librarySourceOf({ ...base, addToAppleMusic: true }, true)).toBe('appleMusic')
    expect(librarySourceOf({ ...base, addToEngineDj: true }, true)).toBe('engineDj')
    expect(librarySourceOf(base, true)).toBeNull()
  })

  // Folder, beside-original and overwrite land in no library; checking one would flag
  // tracks the conversion will never put there.
  it('reports no source for folder, beside and overwrite destinations', () => {
    expect(librarySourceOf({ ...base, overwriteOriginal: true, addToAppleMusic: true }, true)).toBeNull()
    expect(
      librarySourceOf({ ...base, convertBesideOriginal: true, addToAppleMusic: true }, true),
    ).toBeNull()
  })

  // The Apple Music bridge only exists on macOS; the Engine database is plain SQLite
  // everywhere, so only the former is platform-gated.
  it('gates Apple Music on macOS but not Engine DJ', () => {
    expect(librarySourceOf({ ...base, addToAppleMusic: true }, false)).toBeNull()
    expect(librarySourceOf({ ...base, addToEngineDj: true }, false)).toBe('engineDj')
  })

  // FLAC pins the Apple Music destination back to the folder, so its check hides too;
  // Engine plays FLAC and keeps its source.
  it('follows the FLAC pin', () => {
    expect(
      librarySourceOf({ ...base, addToAppleMusic: true, outputFormat: 'flac' }, true),
    ).toBeNull()
    expect(librarySourceOf({ ...base, addToEngineDj: true, outputFormat: 'flac' }, true)).toBe(
      'engineDj',
    )
  })

  it('reports no source before settings load', () => {
    expect(librarySourceOf(null, true)).toBeNull()
  })
})
