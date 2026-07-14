import { describe, expect, it } from 'vitest'
import { emptyMetadata, METADATA_KEYS, searchHintsOf } from './metadata'
import type { TrackMetadata } from './types'

// A track with every metadata field carrying a value — the exact state the editor's
// "Clear all metadata" must fully reset. Built explicitly (not from emptyMetadata) so a
// field added to TrackMetadata but forgotten in the SSOT surfaces here as a value that
// survives the clear, instead of shipping as a silent "clear doesn't clear" bug.
const FULLY_TAGGED: TrackMetadata = {
  title: 'Track',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Album Artist',
  year: '2020',
  genre: 'House',
  grouping: 'Group',
  comment: 'Comment',
  trackNumber: '3',
  discNumber: '1',
  bpm: '128',
  key: '8A',
  publisher: 'Label',
  catalogNumber: 'CAT001',
  remixArtist: 'Remixer',
  discogsReleaseId: '12345',
  rating: '5',
  composer: 'Composer',
  isrc: 'USRC17607839',
  mixName: 'Club Mix',
  originalYear: '2019',
  compilation: '1',
  mood: 'Dark',
  energy: '4',
}

describe('emptyMetadata', () => {
  it('empties every field so a cleared track truly starts blank', () => {
    // Spread the clear over a fully-tagged track: any field the SSOT omits keeps its
    // original value here and fails the assertion below.
    const cleared = { ...FULLY_TAGGED, ...emptyMetadata() }
    for (const key of Object.keys(FULLY_TAGGED) as (keyof TrackMetadata)[]) {
      expect(cleared[key], `${key} was not cleared`).toBe('')
    }
  })

  it('covers exactly the TrackMetadata fields, no more and no less', () => {
    expect(new Set(METADATA_KEYS)).toEqual(new Set(Object.keys(FULLY_TAGGED)))
  })
})

describe('searchHintsOf', () => {
  // A provider search is biased by artist/title and pinned by the catalog number; the
  // other tags would only add noise, so the hints carry exactly these three fields.
  it('carries artist, title and catalog number from the metadata', () => {
    expect(searchHintsOf(FULLY_TAGGED)).toEqual({
      artist: 'Artist',
      title: 'Track',
      catalogNumber: 'CAT001',
    })
  })
})
