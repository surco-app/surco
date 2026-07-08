import type { BpmResult, KeyNotation, KeyResult, TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { BULK_FIELDS, commonValue } from './bulkEdit'
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
  key: keyof TrackMetadata
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  wide?: boolean
  invalid?: boolean
  suggestions?: string[]
  multiSuggestions?: boolean
  insertSources?: InsertSource[]
  cleanResult?: string
  formatResult?: string
}

// The free-text fields that host the { } insert menu — the ones where composing a
// value out of other fields or fixing its case makes sense. Structured single
// values (year, BPM, key, track numbers, ISRC, the Discogs id) stay out: they'd
// swallow a pasted title whole. So do the chip-driven genre/grouping and the
// compilation checkbox.
const INSERT_TARGET_FIELDS: ReadonlySet<keyof TrackMetadata> = new Set([
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
  setField: (key: keyof TrackMetadata, value: string) => void
  onChangeAllMeta?: (patch: Partial<TrackMetadata>) => void
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
  detectedBpm,
  detectedKey,
  keyNotation,
  insertSources,
  albumCleanResult,
  titleFormatResult,
  tr,
  setField,
  onChangeAllMeta,
}: BuildFieldSpecsParams): FieldSpec[] {
  return isMulti && selectedTracks
    ? BULK_FIELDS.filter((key) => visibleFields.includes(key)).map((key) => {
        const shared = commonValue(selectedTracks, key)
        return {
          key,
          label: tr(`fields.${key}`),
          value: shared ?? '',
          placeholder: shared === undefined ? tr('editor.multipleValues') : undefined,
          onChange: (v: string) => onChangeAllMeta?.({ [key]: v }),
          suggestions:
            key === 'genre' ? genreChips : key === 'grouping' ? groupingPresets : undefined,
          multiSuggestions: key === 'grouping',
        }
      })
    : visibleFields.flatMap((key) => {
        const def = FIELD_DEFS.find((d) => d.key === key)
        if (!def) return []
        return [
          {
            key: def.key,
            label: tr(`fields.${def.key}`),
            value: item.meta[def.key] ?? '',
            onChange: (v: string) => setField(def.key, v),
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
            multiSuggestions: def.key === 'grouping',
          },
        ]
      })
}
