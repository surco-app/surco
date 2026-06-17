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

// The Discogs release-format buckets the search filter can restrict to. These are the
// exact tokens Discogs returns in a result's `format` array — and accepts as the
// server-side `format` query param — so they double as the stored setting values and
// need no translation table to compare against. ('File' is Discogs' name for digital.)
export const DISCOGS_FORMATS = ['Vinyl', 'CD', 'File', 'Cassette'] as const
export type DiscogsFormat = (typeof DISCOGS_FORMATS)[number]
