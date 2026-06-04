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
