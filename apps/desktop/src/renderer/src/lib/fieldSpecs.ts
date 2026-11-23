import { effectiveMeta } from '../../../shared/customFields'
import type {
  BpmResult,
  CustomField,
  KeyNotation,
  KeyResult,
  MetaTextKey,
  PlaylistLibrary,
  RekordboxPlaylistTarget,
  SourceNode,
  TrackMetadata,
} from '../../../shared/types'
import type { TrackItem } from '../types'
import { BULK_FIELDS, commonValue, type TagList } from './bulkEdit'
import { FIELD_DEFS, type FieldWidth, isPlaylistField, PLAYLIST_FIELDS } from './fields'
import type { PlaylistOption } from './rekordboxPlaylists'

// One value offered by a field's { } insert menu — another field's literal value, so
// a comment can pull in the artist or title without retyping.
export interface InsertSource {
  key: string
  label: string
  value: string
}

export type PlaylistsDisabled = 'unconfirmed'

export interface PlaylistsSpec {
  library: PlaylistLibrary
  disabled?: PlaylistsDisabled
  tree: SourceNode[]
  options: PlaylistOption[]
  single: {
    value: RekordboxPlaylistTarget[]
    onChange: (next: RekordboxPlaylistTarget[]) => void
  }
  bulk: {
    states: { target: RekordboxPlaylistTarget; state: 'all' | 'some' }[]
    onToggle: (target: RekordboxPlaylistTarget, on: boolean) => void
  }
}

function countValues(values: string[]): { value: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const value of values) {
    if (value !== '') counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count)
}

const UNMEASURED_BPM = /^\s*0+(\.0+)?\s*$/

function valueCounts(tracks: TrackItem[], key: MetaTextKey): { value: string; count: number }[] {
  return countValues(tracks.map((t) => t.meta[key] ?? ''))
}

// What a mixed field shows in place of a value: the values themselves when few enough to read,
// otherwise how many there are. A track with nothing counts as a value of its own: without it
// "A" would read as a value they all share. A box sized for its value cuts even the count, so
// there it shows the mixed mark and the tooltip says what it stands for; a bare number would
// be shorter but reads as the value itself ("3" in Track No.).
const MIXED_MARK = '≠'

function mixedPlaceholder(
  values: { value: string }[],
  hasEmpty: boolean,
  width: FieldWidth | undefined,
  tr: BuildFieldSpecsParams['tr'],
): { placeholder: string; placeholderHint?: string; placeholderTooltip: boolean } {
  const shown = values.map((v) => v.value)
  if (hasEmpty) shown.push(tr('editor.emptyValue'))
  const listed = shown.length <= 3
  const text = listed ? shown.join(' · ') : tr('editor.valuesCount', { count: shown.length })
  if (width) return { placeholder: MIXED_MARK, placeholderHint: text, placeholderTooltip: true }
  return { placeholder: text, placeholderTooltip: listed }
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
  // The placeholder spells out the values, or sits in a box too narrow for any of it, so a
  // tooltip adds the part the box cuts; a bare count in a full-width box says it all.
  placeholderTooltip?: boolean
  placeholderHint?: string
  multiline?: boolean
  width?: FieldWidth
  required?: boolean
  invalid?: boolean
  // A selection whose tracks disagree on this field: the value shows blank, so the Field
  // says so in words where the placeholder alone would not reach a screen reader.
  mixed?: boolean
  mixedValues?: { value: string; count: number }[]
  suggestions?: string[]
  tagList?: TagList
  // True while an audio-derived suggestion (BPM/Key) is still being detected: no chip
  // yet, but the field shows a placeholder chip so the real one doesn't pop in cold.
  suggesting?: boolean
  audioDerived?: boolean
  insertSources?: InsertSource[]
  cleanResult?: string
  formatResult?: string
  formatAction?: FieldFormatAction
  cleaned?: FieldCleanedNote
  readOnly?: boolean
  readOnlyNote?: string
  // Read-only because a selection cannot write one value into every track: drawn as text in
  // the field's own row rather than as a box, unlike Quality, which is a box you cannot type in.
  plain?: boolean
  // A button beside a read-only per-track field that fills it for the whole selection.
  action?: { label: string; onApply: () => void }
  perTrack?: {
    list: TagList
    tracks: TrackItem[]
    onChangeTracks: (patches: { id: string; meta: Partial<TrackMetadata> }[]) => void
  }
  playlists?: PlaylistsSpec & { multi: boolean }
}

// What the load-time clean-up did to this field, and how to put the value as read back.
export interface FieldCleanedNote {
  reasons: string
  onUndo?: () => void
}

export interface FieldFormatAction {
  onApply: () => void
  disabled: boolean
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
  // The required fields the convert gate holds a selection back for (its `missing.fields`),
  // so the form marks exactly the ones the footer names.
  heldBackFields?: string[]
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
  titleFormatAction?: FieldFormatAction
  tr: (key: string, options?: Record<string, unknown>) => string
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
  numberTracks?: () => void
  // Year holds a whole release date, which needs a wider box than a year.
  fullReleaseDate: boolean
  cleanedNotes?: Partial<Record<string, FieldCleanedNote>>
  playlists?: Partial<Record<PlaylistLibrary, PlaylistsSpec>>
  // Quality as the next save writes it, set only while its Auto is on.
  analyzedQuality?: string
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

function playlistsField(
  playlists: PlaylistsSpec,
  multi: boolean,
  tr: (key: string) => string,
): FieldSpec {
  const key = PLAYLIST_FIELDS[playlists.library]
  return {
    key,
    label: tr(`fields.${key}`),
    value: '',
    onChange: () => {},
    playlists: { ...playlists, multi },
  }
}

function playlistsFor(
  playlists: BuildFieldSpecsParams['playlists'],
  key: string,
): PlaylistsSpec | undefined {
  return Object.values(playlists ?? {}).find((p) => p && PLAYLIST_FIELDS[p.library] === key)
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
  heldBackFields = [],
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
  titleFormatAction,
  tr,
  singleOnChange,
  bulkOnChange,
  customFields,
  customValues,
  customOnChange,
  customBulkOnChange,
  onChangeTracksMeta,
  numberTracks,
  fullReleaseDate,
  cleanedNotes,
  playlists,
  analyzedQuality,
}: BuildFieldSpecsParams): FieldSpec[] {
  const widthOf = (key: MetaTextKey): FieldWidth | undefined =>
    key === 'year' && fullReleaseDate ? 'medium' : FIELD_DEFS.find((d) => d.key === key)?.width
  const multilineOf = (key: MetaTextKey): boolean | undefined =>
    FIELD_DEFS.find((d) => d.key === key)?.multiline
  // Each selected track's custom values, resolved once for every custom field below.
  const selectedCustom =
    isMulti && selectedTracks && customFields.length > 0
      ? selectedTracks.map((t) => effectiveMeta(t, customFields).custom ?? {})
      : []
  const requirement = (key: string): Pick<FieldSpec, 'required' | 'invalid'> => ({
    required: requiredFields.includes(key),
    invalid: heldBackFields.includes(key),
  })
  const bulkSpec = (key: (typeof BULK_FIELDS)[number], tracks: TrackItem[]): FieldSpec => {
    const shared = commonValue(tracks, key)
    const list = tagListFor(key, genreTags, groupingTags)
    const perTrack =
      list && onChangeTracksMeta ? { list, tracks, onChangeTracks: onChangeTracksMeta } : undefined
    const mixed = shared === undefined && !perTrack
    const mixedValues = mixed ? valueCounts(tracks, key) : undefined
    const width = widthOf(key)
    return {
      key,
      label: tr(`fields.${key}`),
      value: shared ?? '',
      // The mixed flag still says "multiple values" in words to a screen reader.
      ...(mixedValues
        ? mixedPlaceholder(
            mixedValues,
            tracks.some((t) => !t.meta[key]),
            width,
            tr,
          )
        : {}),
      width,
      multiline: multilineOf(key),
      mixed,
      mixedValues,
      onChange: bulkOnChange.get(key) ?? (() => {}),
      suggestions:
        key === 'genre'
          ? genreChips
          : key === 'grouping'
            ? groupingPresets
            : key === 'trackTotal'
              ? [String(tracks.length)]
              : undefined,
      tagList: list,
      perTrack,
      ...requirement(key),
    }
  }
  const customSpec = (f: CustomField): FieldSpec => {
    const values = selectedCustom.map((c) => c[f.key] ?? '')
    const shared = values.every((v) => v === values[0]) ? values[0] : undefined
    const mixedValues = shared === undefined ? countValues(values) : undefined
    return {
      key: f.key,
      label: f.label,
      value: shared ?? '',
      ...(mixedValues ? mixedPlaceholder(mixedValues, values.includes(''), undefined, tr) : {}),
      mixed: shared === undefined,
      mixedValues,
      onChange: customBulkOnChange.get(f.key) ?? (() => {}),
      ...requirement(f.key),
    }
  }
  // A per-track field over a selection: shown where the user put it so the form matches the
  // single one, but read-only because one value written into every track would erase what
  // tells them apart. Differing values show as a blank listing them, not as a choice.
  const perTrackSpec = (key: MetaTextKey, tracks: TrackItem[]): FieldSpec => {
    const shared = commonValue(tracks, key)
    const width = widthOf(key)
    return {
      key,
      label: tr(`fields.${key}`),
      value: shared ?? '',
      ...(shared === undefined
        ? mixedPlaceholder(
            valueCounts(tracks, key),
            tracks.some((t) => !t.meta[key]),
            width,
            tr,
          )
        : shared === ''
          ? { placeholder: tr('editor.emptyValue') }
          : {}),
      width,
      readOnly: true,
      // Track no. keeps its box: its numbering button sits beside it, and beside loose text
      // the button read as unrelated to the field it numbers, unlike next to Year's box.
      plain: key !== 'trackNumber',
      readOnlyNote: tr('editor.perTrackOnly'),
      action:
        key === 'trackNumber' && numberTracks
          ? { label: tr('editor.numberTracks', { count: tracks.length }), onApply: numberTracks }
          : undefined,
      onChange: () => {},
      ...requirement(key),
    }
  }
  // One walk over visibleFields keeps the user's order; each key maps to its multi spec, or
  // to none when the selection form does not offer it.
  const multiSpecs = (tracks: TrackItem[]): FieldSpec[] =>
    visibleFields.flatMap((key): FieldSpec[] => {
      if (isPlaylistField(key)) {
        const spec = playlistsFor(playlists, key)
        return spec ? [playlistsField(spec, true, tr)] : []
      }
      const bulkKey = BULK_FIELDS.find((k) => k === key)
      if (bulkKey) return [bulkSpec(bulkKey, tracks)]
      const def = FIELD_DEFS.find((d) => d.key === key)
      if (def && def.key !== 'compilation') return [perTrackSpec(def.key, tracks)]
      const custom = customFields.find((f) => f.key === key)
      return custom ? [customSpec(custom)] : []
    })
  return isMulti && selectedTracks
    ? multiSpecs(selectedTracks)
    : visibleFields.flatMap((key) => {
        if (isPlaylistField(key)) {
          const spec = playlistsFor(playlists, key)
          return spec ? [playlistsField(spec, false, tr)] : []
        }
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
        const analyzed = def.key === 'quality' ? analyzedQuality : undefined
        const stored = item.meta[def.key] ?? ''
        const shown = def.key === 'bpm' && UNMEASURED_BPM.test(stored) ? '' : stored
        return [
          {
            key: def.key,
            label: tr(`fields.${def.key}`),
            value: analyzed ?? shown,
            readOnly: analyzed !== undefined,
            onChange: singleOnChange.get(def.key) ?? (() => {}),
            // Only the free-text fields host the { } menu (see INSERT_TARGET_FIELDS);
            // the Field itself filters out the empty and the self entry.
            insertSources:
              !isMulti && INSERT_TARGET_FIELDS.has(def.key) ? insertSources : undefined,
            cleanResult: !isMulti && def.key === 'album' ? albumCleanResult : undefined,
            formatResult: !isMulti && def.key === 'title' ? titleFormatResult : undefined,
            formatAction: def.key === 'title' ? titleFormatAction : undefined,
            cleaned: cleanedNotes?.[def.key],
            width: widthOf(def.key),
            multiline: def.multiline,
            required: requiredFields.includes(def.key),
            invalid: requiredFields.includes(def.key) && !stored.trim(),
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
            audioDerived: def.key === 'bpm' || def.key === 'key',
            tagList: tagListFor(def.key, genreTags, groupingTags),
          },
        ]
      })
}
