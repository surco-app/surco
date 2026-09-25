import { effectiveMeta } from '../../../shared/customFields'
import type {
  BpmResult,
  CustomField,
  KeyNotation,
  KeyResult,
  MetaTextKey,
  TrackMetadata,
} from '../../../shared/types'
import type { TrackItem } from '../types'
import { BULK_FIELDS, commonValue, type TagList } from './bulkEdit'
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
  key: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
  invalid?: boolean
  // A selection whose tracks disagree on this field: the value shows blank, so the Field
  // says so in words where the placeholder alone would not reach a screen reader.
  mixed?: boolean
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
  // Genre and Grouping's tag lists with the separators from settings, built once like the
  // onChange maps below so the memoized fields keep a stable prop.
  genreTags: TagList
  groupingTags: TagList
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
  // The same per key for a selection: writes the value into every selected track.
  customBulkOnChange: ReadonlyMap<string, (v: string) => void>
  onChangeTracksMeta?: (patches: { id: string; meta: Partial<TrackMetadata> }[]) => void
}

// The fields whose chips add a tag rather than replace the value.
function tagListFor(
  key: MetaTextKey,
  genreTags: TagList,
  groupingTags: TagList,
): TagList | undefined {
  if (key === 'grouping') return groupingTags
  if (key === 'genre') return genreTags
  return undefined
}

// The bulk and single forms render the same tree; only where a field's value comes
// from and where an edit goes differ, so each mode reduces to a list of specs the
// form maps over.
// Bulk mode starts from BULK_FIELDS (only release-level fields make sense across a
// selection) but still honours the user's visible-fields setting, so hidden fields
// don't reappear just because several tracks are selected.
export function buildFieldSpecs({
  isMulti,
  selectedTracks,
  visibleFields,
  requiredFields,
  item,
  genreChips,
  groupingPresets,
  genreTags,
  groupingTags,
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
  customBulkOnChange,
  onChangeTracksMeta,
}: BuildFieldSpecsParams): FieldSpec[] {
  // Each selected track's custom values, resolved once for every custom field below.
  const selectedCustom =
    isMulti && selectedTracks && customFields.length > 0
      ? selectedTracks.map((t) => effectiveMeta(t, customFields).custom ?? {})
      : []
  return isMulti && selectedTracks
    ? [
        ...BULK_FIELDS.filter((key) => visibleFields.includes(key)).map((key) => {
          const shared = commonValue(selectedTracks, key)
          const list = tagListFor(key, genreTags, groupingTags)
          const perTrack =
            list && onChangeTracksMeta
              ? { list, tracks: selectedTracks, onChangeTracks: onChangeTracksMeta }
              : undefined
          const mixed = shared === undefined && !perTrack
          return {
            key,
            label: tr(`fields.${key}`),
            value: shared ?? '',
            placeholder: mixed ? tr('editor.multipleValues') : undefined,
            mixed,
            onChange: bulkOnChange.get(key) ?? (() => {}),
            suggestions:
              key === 'genre'
                ? genreChips
                : key === 'grouping'
                  ? groupingPresets
                  : key === 'trackTotal'
                    ? [String(selectedTracks.length)]
                    : undefined,
            tagList: list,
            perTrack,
          }
        }),
        ...customFields
          .filter((f) => visibleFields.includes(f.key))
          .map((f) => {
            const values = selectedCustom.map((c) => c[f.key] ?? '')
            const shared = values.every((v) => v === values[0]) ? values[0] : undefined
            return {
              key: f.key,
              label: f.label,
              value: shared ?? '',
              placeholder: shared === undefined ? tr('editor.multipleValues') : undefined,
              mixed: shared === undefined,
              onChange: customBulkOnChange.get(f.key) ?? (() => {}),
            }
          }),
      ]
    : visibleFields.flatMap((key) => {
        const def = FIELD_DEFS.find((d) => d.key === key)
        if (!def) {
          // A field the user added: no chips or menus of its own, just its name, value and
          // writer. A key that names none (a field deleted in Settings) is skipped.
          const field = customFields.find((f) => f.key === key)
          if (!field) return []
          const value = customValues[key] ?? ''
          return [
            {
              key,
              label: field.label,
              value,
              onChange: customOnChange.get(key) ?? (() => {}),
              required: requiredFields.includes(key),
              invalid: requiredFields.includes(key) && !value.trim(),
            },
          ]
        }
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
            required: requiredFields.includes(def.key),
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
            tagList: tagListFor(def.key, genreTags, groupingTags),
          },
        ]
      })
}
