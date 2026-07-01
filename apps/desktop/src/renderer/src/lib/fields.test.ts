import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import {
  DEFAULT_FIELDS,
  DEFAULT_REQUIRED_FIELDS,
  FIELD_DEFS,
  FIELD_GROUPS,
  groupHeaderBefore,
  groupOfField,
  missingRequired,
  moveItem,
  sortFieldsByGroup,
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

describe('FIELD_GROUPS', () => {
  it('assigns every catalogued field to exactly one group so the form can never orphan a field', () => {
    // A field with no group would silently vanish from the grouped form, so the
    // partition must cover the whole catalog with no overlap.
    const grouped = FIELD_GROUPS.flatMap((g) => g.fields)
    const catalog = FIELD_DEFS.map((d) => d.key)
    expect([...grouped].sort()).toEqual([...catalog].sort())
    expect(new Set(grouped).size).toBe(grouped.length)
  })

  it('leads with the identity group so the most-edited tags sit at the top', () => {
    expect(FIELD_GROUPS[0].id).toBe('identity')
    expect(FIELD_GROUPS[0].fields).toContain('title')
    expect(FIELD_GROUPS[0].fields).toContain('artist')
  })
})

describe('groupOfField', () => {
  it('maps a field to its group id so the form knows where a header starts', () => {
    expect(groupOfField('title')).toBe('identity')
    expect(groupOfField('bpm')).toBe('dj')
    expect(groupOfField('catalogNumber')).toBe('catalog')
    expect(groupOfField('trackNumber')).toBe('order')
  })
})

describe('sortFieldsByGroup', () => {
  it('reorders the visible fields into group order so auto-organize tidies a messy list', () => {
    // A user who enabled fields ad hoc ends up with a jumble; the button lays them
    // out identity → catalog → dj → order without touching what is shown.
    expect(sortFieldsByGroup(['bpm', 'title', 'catalogNumber', 'artist'])).toEqual([
      'title',
      'artist',
      'catalogNumber',
      'bpm',
    ])
  })

  it('keeps a field visible even if it is not catalogued, appending it at the end', () => {
    // Defensive: an unknown key (e.g. a future tag) must not be dropped by a reorder.
    expect(sortFieldsByGroup(['bpm', 'mystery', 'title'])).toEqual(['title', 'bpm', 'mystery'])
  })

  it('preserves the in-group order from FIELD_GROUPS, not the input order', () => {
    // Within identity, artist precedes album regardless of how the user had them.
    expect(sortFieldsByGroup(['album', 'artist'])).toEqual(['artist', 'album'])
  })
})

describe('groupHeaderBefore', () => {
  const order = ['title', 'artist', 'catalogNumber', 'bpm']

  it('marks a header at the first field of each group so the form shows one header per section', () => {
    // identity opens at index 0, then a new header wherever the group changes.
    expect(groupHeaderBefore(order, 0)).toBe('identity')
    expect(groupHeaderBefore(order, 2)).toBe('catalog')
    expect(groupHeaderBefore(order, 3)).toBe('dj')
  })

  it('returns undefined for a field that continues the current group so no duplicate header renders', () => {
    expect(groupHeaderBefore(order, 1)).toBeUndefined()
  })

  it('re-emits a header when the same group reappears after another, since a manual order can interleave', () => {
    // A user who hand-orders title, bpm, artist gets identity, dj, then identity again —
    // the header follows the actual layout rather than assuming groups are contiguous.
    const interleaved = ['title', 'bpm', 'artist']
    expect(groupHeaderBefore(interleaved, 0)).toBe('identity')
    expect(groupHeaderBefore(interleaved, 1)).toBe('dj')
    expect(groupHeaderBefore(interleaved, 2)).toBe('identity')
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
