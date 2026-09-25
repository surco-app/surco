import { effectiveMeta, fieldValue } from '../../../shared/customFields'
import type { CustomField, MetaTextKey, TrackMetadata } from '../../../shared/types'

// A field whose tag holds a bounded value gets a box sized to it: 'short' fits a year, a
// BPM with a decimal, a Camelot key or a track number; 'medium' an ISRC or a Discogs id.
// The rest are free text with no reliable limit and take the column's width.
export type FieldWidth = 'short' | 'medium'

interface FieldDef {
  key: MetaTextKey
  width?: FieldWidth
}

export const FIELD_DEFS: FieldDef[] = [
  { key: 'title' },
  { key: 'artist' },
  { key: 'albumArtist' },
  { key: 'album' },
  { key: 'year', width: 'short' },
  { key: 'genre' },
  { key: 'style' },
  { key: 'grouping' },
  { key: 'trackNumber', width: 'short' },
  { key: 'comment' },
  { key: 'discNumber', width: 'short' },
  { key: 'trackTotal', width: 'short' },
  { key: 'discTotal', width: 'short' },
  { key: 'bpm', width: 'short' },
  { key: 'key', width: 'short' },
  { key: 'remixArtist' },
  { key: 'mixName' },
  { key: 'composer' },
  { key: 'originalArtist' },
  { key: 'lyricist' },
  { key: 'conductor' },
  { key: 'copyright' },
  { key: 'encodedBy' },
  { key: 'originalYear', width: 'short' },
  { key: 'isrc', width: 'medium' },
  { key: 'compilation' },
  { key: 'publisher' },
  { key: 'catalogNumber' },
  { key: 'discogsReleaseId', width: 'medium' },
  { key: 'discogsUrl' },
  { key: 'country' },
  { key: 'mediaType' },
  { key: 'mood' },
  { key: 'energy', width: 'short' },
]

// Which section a field belongs to in the grouped form. The four groups sort the
// otherwise-flat wall of inputs into a scannable order: what identifies the track,
// its release/catalog data, the DJ-facing analysis, and its ordering within a set.
// Fixed on purpose — the user chooses which fields to show, not which group they
// live in, so the layout stays predictable across tracks.
type FieldGroupId = 'identity' | 'catalog' | 'dj' | 'order'

interface FieldGroup {
  id: FieldGroupId
  fields: MetaTextKey[]
}

export const FIELD_GROUPS: FieldGroup[] = [
  {
    id: 'identity',
    fields: ['title', 'artist', 'albumArtist', 'album', 'year', 'genre', 'style', 'grouping'],
  },
  {
    id: 'catalog',
    fields: [
      'publisher',
      'catalogNumber',
      'isrc',
      'discogsReleaseId',
      'discogsUrl',
      'country',
      'mediaType',
      'composer',
      'originalArtist',
      'lyricist',
      'conductor',
      'copyright',
      'encodedBy',
    ],
  },
  { id: 'dj', fields: ['bpm', 'key', 'mood', 'energy', 'mixName', 'remixArtist', 'originalYear'] },
  {
    id: 'order',
    fields: ['trackNumber', 'trackTotal', 'discNumber', 'discTotal', 'compilation', 'comment'],
  },
]

// The group a field sits in, or undefined for a key not in any group (a future tag).
export function groupOfField(key: string): FieldGroupId | undefined {
  return FIELD_GROUPS.find((g) => g.fields.includes(key as MetaTextKey))?.id
}

// Reorders the shown fields into group order (identity → catalog → dj → order), keeping
// each group's own order. Only reorders — it never shows or hides a field, so the user's
// selection is untouched. An uncatalogued key keeps its place at the end so a reorder can
// never drop a field. This backs the "auto-organize" button in Settings → Fields.
export function sortFieldsByGroup(visibleFields: string[]): string[] {
  const order = FIELD_GROUPS.flatMap((g) => g.fields)
  const rank = (key: string): number => {
    const i = order.indexOf(key as MetaTextKey)
    return i === -1 ? order.length : i
  }
  return [...visibleFields]
    .map((key, i) => ({ key, i }))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.i - b.i)
    .map((e) => e.key)
}

// Re-exported from shared so renderer code can keep importing them from here
// while main/settings reads the same source — see shared/defaults.
export {
  DEFAULT_FIELDS,
  DEFAULT_IMPORT_FIELDS,
  DEFAULT_REQUIRED_FIELDS,
  IMPORTABLE_FIELDS,
} from '../../../shared/defaults'

// Every field the form can show, Surco's and the user's own, with the name the user reads:
// the translated label, or the one the user gave a custom field.
export function labeledFields(
  customFields: readonly CustomField[],
  tr: (key: string) => string,
): { key: string; label: string }[] {
  return [
    ...FIELD_DEFS.map((d) => ({ key: d.key as string, label: tr(`fields.${d.key}`) })),
    ...customFields.map((f) => ({ key: f.key, label: f.label })),
  ]
}

export function missingRequired(meta: TrackMetadata, requiredFields: string[]): string[] {
  return requiredFields.filter((key) => !fieldValue(meta, key).trim())
}

// The same check off a track, resolving its custom fields only when one of them is required:
// the gate runs over whole lists on every change, and most never require a custom field.
export function missingRequiredOf(
  track: Parameters<typeof effectiveMeta>[0],
  requiredFields: string[],
  customFields: readonly CustomField[],
): string[] {
  const needsCustom = customFields.some((f) => requiredFields.includes(f.key))
  return missingRequired(
    needsCustom ? effectiveMeta(track, customFields) : track.meta,
    requiredFields,
  )
}

export function moveItem<T>(arr: T[], index: number, delta: number): T[] {
  const to = index + delta
  if (index < 0 || index >= arr.length || to < 0 || to >= arr.length) return arr
  const copy = [...arr]
  const [item] = copy.splice(index, 1)
  copy.splice(to, 0, item)
  return copy
}
