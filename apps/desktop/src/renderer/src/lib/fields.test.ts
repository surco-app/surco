import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import {
  DEFAULT_FIELDS,
  DEFAULT_REQUIRED_FIELDS,
  FIELD_DEFS,
  missingRequired,
  moveItem,
} from './fields'

const meta: TrackMetadata = {
  title: 'Gold',
  artist: 'Alex Ponce',
  album: '',
  albumArtist: '',
  year: '2025',
  genre: '   ',
  grouping: '',
  comment: '',
  trackNumber: '',
  discNumber: '',
  bpm: '',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
}

describe('moveItem', () => {
  it('moves an item down so the user can reorder a shown field', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
  })

  it('moves an item up', () => {
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
  })

  it('returns the array untouched when the move falls off either end', () => {
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
  })
})

describe('DEFAULT_FIELDS', () => {
  it('shows the core tags by default but keeps the advanced ones hidden until enabled', () => {
    // advanced DJ/label tags ship in the catalog so Settings can offer them,
    // but the default editor stays uncluttered — they are opt-in
    expect(DEFAULT_FIELDS).toContain('trackNumber')
    expect(DEFAULT_FIELDS).not.toContain('bpm')
    expect(DEFAULT_FIELDS).not.toContain('publisher')
    expect(FIELD_DEFS.map((d) => d.key)).toContain('bpm')
    expect(FIELD_DEFS.map((d) => d.key)).toContain('publisher')
  })
})

describe('missingRequired', () => {
  it('reports required fields that are empty so processing is blocked until they are filled', () => {
    expect(missingRequired(meta, ['title', 'album', 'albumArtist'])).toEqual([
      'album',
      'albumArtist',
    ])
  })

  it('treats whitespace-only values as missing, since a blank genre tags the track with nothing useful', () => {
    expect(missingRequired(meta, ['genre'])).toEqual(['genre'])
  })

  it('returns nothing when every required field has a value', () => {
    expect(missingRequired(meta, ['title', 'artist', 'year'])).toEqual([])
  })

  it('ignores fields that are not required even when empty', () => {
    expect(missingRequired(meta, [])).toEqual([])
  })
})

describe('DEFAULT_REQUIRED_FIELDS', () => {
  it('blocks only on title and artist, the bare minimum that identifies a track', () => {
    // Everything else (album artist, album, year, genre, grouping) is recommended
    // but not gated by default: a white label or promo with no release on Discogs
    // should still convert. Users add their own required fields in Settings.
    expect(DEFAULT_REQUIRED_FIELDS).toEqual(['title', 'artist'])
  })
})
