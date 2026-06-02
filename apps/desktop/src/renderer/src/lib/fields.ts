import type { TrackMetadata } from '../../../shared/types'

export interface FieldDef {
  key: keyof TrackMetadata
  wide?: boolean
}

export const FIELD_DEFS: FieldDef[] = [
  { key: 'title', wide: true },
  { key: 'artist' },
  { key: 'albumArtist' },
  { key: 'album' },
  { key: 'year' },
  { key: 'genre' },
  { key: 'grouping' },
  { key: 'trackNumber' },
  { key: 'comment', wide: true },
  { key: 'discNumber' },
  { key: 'bpm' },
  { key: 'key' },
  { key: 'remixArtist' },
  { key: 'publisher' },
  { key: 'catalogNumber' },
]

// The core tags shown by default. The advanced ones above (disc, bpm, key,
// remixer, label, catalog) ship hidden so the editor stays uncluttered; users
// turn them on per taste in Settings → Fields.
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

export const DEFAULT_REQUIRED_FIELDS: string[] = [
  'title',
  'artist',
  'albumArtist',
  'album',
  'year',
  'genre',
  'grouping',
]

export function missingRequired(meta: TrackMetadata, requiredFields: string[]): string[] {
  return requiredFields.filter((key) => !meta[key as keyof TrackMetadata]?.trim())
}

export function moveItem<T>(arr: T[], index: number, delta: number): T[] {
  const to = index + delta
  if (index < 0 || index >= arr.length || to < 0 || to >= arr.length) return arr
  const copy = [...arr]
  const [item] = copy.splice(index, 1)
  copy.splice(to, 0, item)
  return copy
}
