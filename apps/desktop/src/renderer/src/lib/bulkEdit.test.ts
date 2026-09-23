import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import {
  commonValue,
  GENRE_TAGS,
  GROUPING_TAGS,
  tagListState,
  tagListTags,
  toggleTagListAll,
} from './bulkEdit'

const emptyMeta: TrackMetadata = {
  title: '',
  artist: '',
  album: '',
  albumArtist: '',
  year: '',
  genre: '',
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

function track(meta: Partial<TrackMetadata>): TrackItem {
  return {
    id: Math.random().toString(),
    inputPath: '/x.flac',
    fileName: 'x.flac',
    listLabel: meta.title ?? 'x.flac',
    query: '',
    meta: { ...emptyMeta, ...meta },
    status: 'idle',
  }
}

describe('commonValue', () => {
  it('returns the shared value when every track agrees', () => {
    const tracks = [track({ album: 'Hard House Nation' }), track({ album: 'Hard House Nation' })]
    expect(commonValue(tracks, 'album')).toBe('Hard House Nation')
  })

  it('returns undefined when the tracks disagree, so the panel can flag it as mixed', () => {
    const tracks = [track({ artist: 'Kumara' }), track({ artist: 'B.F.I.' })]
    expect(commonValue(tracks, 'artist')).toBeUndefined()
  })

  it('treats a value all tracks leave empty as a shared empty, not as mixed', () => {
    // A blank everyone shares must read back as "" (editable, no mixed hint), so the
    // user can fill a field that is uniformly empty across the selection.
    const tracks = [track({}), track({})]
    expect(commonValue(tracks, 'genre')).toBe('')
  })

  it('treats an optional field no track carries as a shared empty too', () => {
    // The later fields (composer, originalYear, compilation) are optional on
    // TrackMetadata, so unset reads as undefined — which must still mean "shared
    // blank", not "mixed", or the bulk panel would flag untouched files as mixed.
    const tracks = [track({}), track({})]
    expect(commonValue(tracks, 'composer')).toBe('')
    expect(commonValue([track({}), track({ composer: 'ATB' })], 'composer')).toBeUndefined()
  })

  it('returns the single track’s value when only one is selected', () => {
    expect(commonValue([track({ year: '2000' })], 'year')).toBe('2000')
  })

  it('returns undefined for an empty selection', () => {
    expect(commonValue([], 'album')).toBeUndefined()
  })
})

describe('tagListState', () => {
  it('reports all, some or none for a tag across the selection', () => {
    const tracks = [
      track({ grouping: 'Bases, Discazos' }),
      track({ grouping: 'Cantaditas, Discazos' }),
    ]
    expect(tagListState(tracks, GROUPING_TAGS, 'Discazos')).toBe('all')
    expect(tagListState(tracks, GROUPING_TAGS, 'Bases')).toBe('some')
    expect(tagListState(tracks, GROUPING_TAGS, 'Cierre')).toBe('none')
  })

  it('matches whole tags, not substrings', () => {
    expect(tagListState([track({ grouping: 'Bases' })], GROUPING_TAGS, 'Base')).toBe('none')
  })
})

describe('toggleTagListAll', () => {
  it('adds the tag only to the tracks missing it, keeping what each one had', () => {
    const a = track({ grouping: 'Bases' })
    const b = track({ grouping: 'Cantaditas, Discazos' })
    expect(toggleTagListAll([a, b], GROUPING_TAGS, 'Discazos')).toEqual([
      { id: a.id, meta: { grouping: 'Bases, Discazos' } },
    ])
  })

  it('removes the tag from every track once all of them carry it', () => {
    const a = track({ grouping: 'Bases, Discazos' })
    const b = track({ grouping: 'Discazos' })
    expect(toggleTagListAll([a, b], GROUPING_TAGS, 'Discazos')).toEqual([
      { id: a.id, meta: { grouping: 'Bases' } },
      { id: b.id, meta: { grouping: '' } },
    ])
  })
})

describe('tagListTags', () => {
  it('lists the presets first, then tags the selection already carries that are not presets', () => {
    const tracks = [track({ grouping: 'Discazos, Bases' }), track({ grouping: 'Cierre' })]
    expect(tagListTags(['Bases', 'Cantaditas'], tracks, GROUPING_TAGS)).toEqual([
      'Bases',
      'Cantaditas',
      'Discazos',
      'Cierre',
    ])
  })

  it('does not offer a second chip for a tag the presets already have in another case', () => {
    const tracks = [track({ genre: 'electronic, funk' }), track({ genre: 'Funk' })]
    expect(tagListTags(['Electronic'], tracks, GENRE_TAGS)).toEqual(['Electronic', 'funk'])
  })
})

// Genre is separated by commas like grouping, so the two fields read the same. Discogs
// names one genre "Folk, World, & Country": split blindly it became three tags, its chip
// never lit up and a second click appended it again.
describe('genre tag list', () => {
  it('keeps a genre that contains commas as one tag', () => {
    const tracks = [track({ genre: 'Folk, World, & Country, Pop' })]
    expect(tagListState(tracks, GENRE_TAGS, 'Folk, World, & Country')).toBe('all')
    expect(tagListState(tracks, GENRE_TAGS, 'World')).toBe('none')
    expect(tagListState(tracks, GENRE_TAGS, 'Pop')).toBe('all')
  })

  it('joins the genres it adds with a comma, as grouping does', () => {
    const a = track({ genre: 'Pop' })
    expect(toggleTagListAll([a], GENRE_TAGS, 'Indie Pop')).toEqual([
      { id: a.id, meta: { genre: 'Pop, Indie Pop' } },
    ])
  })
})
