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
  { key: 'mixName' },
  { key: 'composer' },
  { key: 'originalYear' },
  { key: 'isrc' },
  { key: 'compilation' },
  { key: 'publisher' },
  { key: 'catalogNumber' },
  { key: 'discogsReleaseId' },
  { key: 'mood' },
  { key: 'energy' },
]

// Which section a field belongs to in the grouped form. The four groups sort the
// otherwise-flat wall of inputs into a scannable order: what identifies the track,
// its release/catalog data, the DJ-facing analysis, and its ordering within a set.
// Fixed on purpose — the user chooses which fields to show, not which group they
// live in, so the layout stays predictable across tracks.
export type FieldGroupId = 'identity' | 'catalog' | 'dj' | 'order'

export interface FieldGroup {
  id: FieldGroupId
  fields: (keyof TrackMetadata)[]
}

export const FIELD_GROUPS: FieldGroup[] = [
  {
    id: 'identity',
    fields: ['title', 'artist', 'albumArtist', 'album', 'year', 'genre', 'grouping'],
  },
  { id: 'catalog', fields: ['publisher', 'catalogNumber', 'isrc', 'discogsReleaseId', 'composer'] },
  { id: 'dj', fields: ['bpm', 'key', 'mood', 'energy', 'mixName', 'remixArtist', 'originalYear'] },
  { id: 'order', fields: ['trackNumber', 'discNumber', 'compilation', 'comment'] },
]

// The group a field sits in, or undefined for a key not in any group (a future tag).
export function groupOfField(key: string): FieldGroupId | undefined {
  return FIELD_GROUPS.find((g) => g.fields.includes(key as keyof TrackMetadata))?.id
}

// Reorders the shown fields into group order (identity → catalog → dj → order), keeping
// each group's own order. Only reorders — it never shows or hides a field, so the user's
// selection is untouched. An uncatalogued key keeps its place at the end so a reorder can
// never drop a field. This backs the "auto-organize" button in Settings → Fields.
export function sortFieldsByGroup(visibleFields: string[]): string[] {
  const order = FIELD_GROUPS.flatMap((g) => g.fields)
  const rank = (key: string): number => {
    const i = order.indexOf(key as keyof TrackMetadata)
    return i === -1 ? order.length : i
  }
  return [...visibleFields]
    .map((key, i) => ({ key, i }))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.i - b.i)
    .map((e) => e.key)
}

// The group header to render just before the field at `index`, or undefined when the
// field continues the previous field's group. Follows the actual field order, not the
// group definition, so it works whether the user auto-organized or hand-ordered — an
// interleaved layout re-emits a header each time the group changes.
export function groupHeaderBefore(fields: string[], index: number): FieldGroupId | undefined {
  const here = groupOfField(fields[index])
  if (!here) return undefined
  const prev = index > 0 ? groupOfField(fields[index - 1]) : undefined
  return here === prev ? undefined : here
}

// Re-exported from shared so renderer code can keep importing them from here
// while main/settings reads the same source — see shared/defaults.
export { DEFAULT_FIELDS, DEFAULT_REQUIRED_FIELDS } from '../../../shared/defaults'

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
