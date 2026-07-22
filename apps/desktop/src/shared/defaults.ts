import type { SearchProviderId } from './types'

// Single source of truth for the default field configuration. Lives in shared so
// the renderer (lib/fields) and the persisted default settings (main/settings)
// reference the same lists and can never drift apart.

// The core tags shown in the editor by default. The advanced ones (disc, bpm,
// key, remixer, label, catalog) ship hidden so the editor stays uncluttered;
// users turn them on per taste in Settings → Fields.
export const DEFAULT_FIELDS: string[] = [
  'title',
  'artist',
  'albumArtist',
  'album',
  'year',
  'genre',
  'grouping',
  'trackNumber',
  'comment',
]

// The fields a track must have filled before it can be converted.
export const DEFAULT_REQUIRED_FIELDS: string[] = ['title', 'artist']

// The catalog sources offered as search-provider checkboxes, and all searched by default
// on a new install. Lives in shared so the wizard, Settings and the persisted defaults
// draw from one list and a new source can't reach one surface without the others.
export const SEARCH_PROVIDERS: readonly SearchProviderId[] = ['discogs', 'bandcamp']

// The Discogs release-format buckets the search filter can restrict to. These are the
// exact tokens Discogs returns in a result's `format` array — and accepts as the
// server-side `format` query param — so they double as the stored setting values and
// need no translation table to compare against. ('File' is Discogs' name for digital.)
export const DISCOGS_FORMATS = ['Vinyl', 'CD', 'File', 'Cassette'] as const
export type DiscogsFormat = (typeof DISCOGS_FORMATS)[number]

// How many search results the editor's results column shows by default, and the presets
// offered in Settings → Search. Kept low so the relevant releases sit on screen instead of
// a long noise tail of compilations/reissues; the auto-match probe scans the full set
// independently, so trimming the displayed list never costs a suggestion.
export const DEFAULT_DISCOGS_MAX_RESULTS = 10
export const DISCOGS_MAX_RESULTS_OPTIONS = [5, 10, 15, 25, 50] as const
