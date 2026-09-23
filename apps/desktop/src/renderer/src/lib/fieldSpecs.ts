import type {
  BpmResult,
  CustomField,
  KeyNotation,
  KeyResult,
  MetaTextKey,
  TrackMetadata,
} from '../../../shared/types'
import type { TrackItem } from '../types'
import { BULK_FIELDS, commonValue, GENRE_TAGS, GROUPING_TAGS, type TagList } from './bulkEdit'
import { FIELD_DEFS } from './fields'

// One value offered by a field's { } insert menu — another field's literal value, so
// a comment can pull in the artist or title without retyping.
export interface InsertSource {
  key: string
  label: string
  value: string
}

// One renderable form field. The editor builds these per mode — bulk specs read the
// selection's common value and write through onChangeAllMeta, single specs read the
// open track and write through setField — so the form itself renders a single tree
// instead of forking on every field.
export interface FieldSpec {
  // A managed field's key, or the key of one of the user's own fields.
  key: MetaTextKey | string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  wide?: boolean
  invalid?: boolean
  suggestions?: string[]
  tagList?: TagList
  // True while an audio-derived suggestion (BPM/Key) is still being detected: no chip
  // yet, but the field shows a placeholder chip so the real one doesn't pop in cold.
  suggesting?: boolean
  insertSources?: InsertSource[]
  cleanResult?: string
  formatResult?: string
  perTrack?: {
    list: TagList
    tracks: TrackItem[]
    onChangeTracks: (patches: { id: string; meta: Partial<TrackMetadata> }[]) => void
  }
}

// The free-text fields that host the { } insert menu — the ones where composing a
// value out of other fields or fixing its case makes sense. Structured single
// values (year, BPM, key, track numbers, ISRC, the Discogs id) stay out: they'd
// swallow a pasted title whole. So do the chip-driven genre/grouping and the
// compilation checkbox.
const INSERT_TARGET_FIELDS: ReadonlySet<MetaTextKey> = new Set([
  'title',
  'artist',
  'albumArtist',
  'album',
  'comment',
  'mixName',
  'remixArtist',
  'composer',
  'publisher',
  'catalogNumber',
])

export interface BuildFieldSpecsParams {
  isMulti: boolean
  selectedTracks: TrackItem[] | undefined
  visibleFields: string[]
  requiredFields: string[]
  item: TrackItem
  genreChips: string[]
  groupingPresets: string[]
  detectedBpm: BpmResult | null | undefined
  detectedKey: KeyResult | null | undefined
  keyNotation: KeyNotation
  insertSources: InsertSource[]
  albumCleanResult: string | undefined
  // The title rebuilt from the settings' title format, when that changes anything —
  // offered as a whole-value rewrite in the title field's menu.
  titleFormatResult: string | undefined
  tr: (key: string) => string
  // Pre-built per-key onChange, one map per mode — not setField/onChangeAllMeta
  // themselves. Closing over `key` inline here (`(v) => setField(key, v)`) would
  // hand every FieldSpec a fresh onChange on every call, even though setField
  // itself never changes identity; Field.tsx is memoized on exactly this prop; a
  // fresh one every render defeats that memo and re-renders every field on every
  // keystroke. The maps are built once in Editor.tsx (see fieldOnChangeByKey) and
  // reused across renders since setField/onChangeAllMeta are themselves stable.
  singleOnChange: ReadonlyMap<MetaTextKey, (v: string) => void>
  bulkOnChange: ReadonlyMap<MetaTextKey, (v: string) => void>
  // The user's own fields: their settings entries, the value each holds on this track and
  // a stable writer per key, built once like singleOnChange.
  customFields: readonly CustomField[]
  customValues: Record<string, string>
  customOnChange: ReadonlyMap<string, (v: string) => void>
  onChangeTracksMeta?: (patches: { id: string; meta: Partial<TrackMetadata> }[]) => void
}

// The bulk and single forms render the same tree; only where a field's value comes
// from and where an edit goes differ, so each mode reduces to a list of specs the
// form maps over.
// Bulk mode starts from BULK_FIELDS (only release-level fields make sense across a
// selection) but still honours the user's visible-fields setting, so hidden fields
// don't reappear just because several tracks are selected.
// The fields whose chips add a tag rather than replace the value.
function tagListFor(key: MetaTextKey): TagList | undefined {
  if (key === 'grouping') return GROUPING_TAGS
  if (key === 'genre') return GENRE_TAGS
  return undefined
}

// A field the user added: no groups, chips or menus of its own, just its name, its value
// and its writer. A key that no longer names one (a field deleted in Settings) is skipped.
function customSpecFor(
  p: Pick<
    BuildFieldSpecsParams,
    'customFields' | 'customValues' | 'customOnChange' | 'requiredFields'
  >,
  key: string,
): FieldSpec[] {
  const field = p.customFields.find((f) => f.key === key)
  if (!field) return []
  const value = p.customValues[key] ?? ''
  return [
    {
      key,
      label: field.label,
      value,
      onChange: p.customOnChange.get(key) ?? (() => {}),
      invalid: p.requiredFields.includes(key) && !value.trim(),
    },
  ]
}

export function buildFieldSpecs({
  isMulti,
  selectedTracks,
  visibleFields,
  requiredFields,
  item,
  genreChips,
  groupingPresets,
  detectedBpm,
  detectedKey,
  keyNotation,
  insertSources,
  albumCleanResult,
  titleFormatResult,
  tr,
  singleOnChange,
  bulkOnChange,
  customFields,
  customValues,
  customOnChange,
  onChangeTracksMeta,
}: BuildFieldSpecsParams): FieldSpec[] {
  const custom = { customFields, customValues, customOnChange, requiredFields }
  return isMulti && selectedTracks
    ? BULK_FIELDS.filter((key) => visibleFields.includes(key)).map((key) => {
        const shared = commonValue(selectedTracks, key)
        const list = tagListFor(key)
        const perTrack =
          list && onChangeTracksMeta
            ? { list, tracks: selectedTracks, onChangeTracks: onChangeTracksMeta }
            : undefined
        return {
          key,
          label: tr(`fields.${key}`),
          value: shared ?? '',
          placeholder: shared === undefined && !perTrack ? tr('editor.multipleValues') : undefined,
          onChange: bulkOnChange.get(key) ?? (() => {}),
          suggestions:
            key === 'genre' ? genreChips : key === 'grouping' ? groupingPresets : undefined,
          tagList: list,
          perTrack,
        }
      })
    : visibleFields.flatMap((key) => {
        const def = FIELD_DEFS.find((d) => d.key === key)
        if (!def) return customSpecFor(custom, key)
        return [
          {
            key: def.key,
            label: tr(`fields.${def.key}`),
            value: item.meta[def.key] ?? '',
            onChange: singleOnChange.get(def.key) ?? (() => {}),
            // Only the free-text fields host the { } menu (see INSERT_TARGET_FIELDS);
            // the Field itself filters out the empty and the self entry.
            insertSources:
              !isMulti && INSERT_TARGET_FIELDS.has(def.key) ? insertSources : undefined,
            cleanResult: !isMulti && def.key === 'album' ? albumCleanResult : undefined,
            formatResult: !isMulti && def.key === 'title' ? titleFormatResult : undefined,
            wide: def.wide,
            invalid: requiredFields.includes(def.key) && !item.meta[def.key]?.trim(),
            suggestions:
              def.key === 'genre'
                ? genreChips
                : def.key === 'grouping'
                  ? groupingPresets
                  : def.key === 'bpm' && detectedBpm
                    ? // The tag layer stores whole beats per minute, so the chip
                      // offers the rounded figure.
                      [String(Math.round(detectedBpm.bpm))]
                    : def.key === 'key' && detectedKey
                      ? [keyNotation === 'camelot' ? detectedKey.camelot : detectedKey.name]
                      : undefined,
            // Only in single mode, and only while the probe is genuinely running: the
            // field is visible (buildFieldSpecs only walks visibleFields) and the result
            // is still undefined. A failed probe resolves null → no chip, no placeholder.
            suggesting:
              !isMulti &&
              ((def.key === 'bpm' && detectedBpm === undefined) ||
                (def.key === 'key' && detectedKey === undefined)),
            tagList: tagListFor(def.key),
          },
        ]
      })
}
