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
]

export const DEFAULT_FIELDS: string[] = FIELD_DEFS.map((d) => d.key)

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
