import { describe, expect, it, vi } from 'vitest'
import type { BpmResult, KeyResult, MetaTextKey, TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { BULK_FIELDS, GENRE_TAGS, GROUPING_TAGS } from './bulkEdit'
import { type BuildFieldSpecsParams, buildFieldSpecs } from './fieldSpecs'
import { FIELD_DEFS } from './fields'

// Mirrors the maps Editor.tsx builds with useMemo: one onChange per possible key,
// closing over the given setField/onChangeAllMeta so a test can still assert what
// each field's onChange was called with.
function singleOnChangeFrom(
  setField: (key: MetaTextKey, value: string) => void,
): Map<MetaTextKey, (v: string) => void> {
  return new Map(FIELD_DEFS.map((def) => [def.key, (v: string) => setField(def.key, v)]))
}
function bulkOnChangeFrom(
  onChangeAllMeta: (patch: Partial<TrackMetadata>) => void,
): Map<MetaTextKey, (v: string) => void> {
  return new Map(BULK_FIELDS.map((key) => [key, (v: string) => onChangeAllMeta({ [key]: v })]))
}

function track(id: string, meta: Partial<TrackMetadata> = {}): TrackItem {
  return {
    id,
    inputPath: `/music/${id}.wav`,
    fileName: `${id}.wav`,
    query: '',
    status: 'idle',
    listLabel: id,
    meta: {
      title: '',
      artist: '',
      album: '',
      albumArtist: '',
      year: '',
      genre: '',
      grouping: '',
      comment: '',
      trackNumber: '',
      discNumber: '',
      bpm: '',
      key: '',
      publisher: '',
      catalogNumber: '',
      remixArtist: '',
      ...meta,
    } as TrackMetadata,
  }
}

// The translator only ever receives a key here, so echoing it keeps assertions legible.
const tr = (key: string): string => key

function params(over: Partial<BuildFieldSpecsParams> = {}): BuildFieldSpecsParams {
  return {
    isMulti: false,
    selectedTracks: undefined,
    visibleFields: ['title', 'genre', 'grouping', 'bpm', 'key'],
    requiredFields: [],
    item: track('a', { title: 'Song', genre: 'Techno' }),
    genreChips: ['Techno', 'House'],
    groupingPresets: ['Bases', 'Vocals'],
    genreTags: GENRE_TAGS,
    groupingTags: GROUPING_TAGS,
    detectedBpm: undefined,
    detectedKey: undefined,
    keyNotation: 'camelot',
    insertSources: [{ key: 'artist', label: 'Artist', value: 'X' }],
    albumCleanResult: undefined,
    titleFormatResult: undefined,
    tr,
    singleOnChange: singleOnChangeFrom(vi.fn()),
    bulkOnChange: bulkOnChangeFrom(vi.fn()),
    customFields: [],
    customValues: {},
    customOnChange: new Map(),
    customBulkOnChange: new Map(),
    ...over,
  }
}

describe('buildFieldSpecs onChange identity', () => {
  // Field.tsx is memoized on its onChange prop: a fresh function per rebuild
  // defeats that memo and re-renders every field on every keystroke, even the
  // ones whose value didn't change. buildFieldSpecs must read each field's
  // onChange out of the pre-built map (Editor.tsx's singleOnChange/bulkOnChange)
  // rather than closing over the key inline, so calling it twice with the SAME
  // map — as two rebuilds triggered by unrelated item.meta changes would — hands
  // back the same function reference for a field whose key didn't move.
  it('returns the same onChange reference across two calls given the same map', () => {
    const shared = singleOnChangeFrom(vi.fn())
    const first = buildFieldSpecs(
      params({ visibleFields: ['title', 'artist'], singleOnChange: shared }),
    )
    const second = buildFieldSpecs(
      params({ visibleFields: ['title', 'artist'], singleOnChange: shared }),
    )
    expect(first.find((s) => s.key === 'title')?.onChange).toBe(
      second.find((s) => s.key === 'title')?.onChange,
    )
    expect(first.find((s) => s.key === 'artist')?.onChange).toBe(
      second.find((s) => s.key === 'artist')?.onChange,
    )
  })

  it('does the same for bulk mode against bulkOnChange', () => {
    const shared = bulkOnChangeFrom(vi.fn())
    const tracks = [track('a', { genre: 'Techno' }), track('b', { genre: 'Techno' })]
    const first = buildFieldSpecs(
      params({
        isMulti: true,
        selectedTracks: tracks,
        visibleFields: ['genre'],
        bulkOnChange: shared,
      }),
    )
    const second = buildFieldSpecs(
      params({
        isMulti: true,
        selectedTracks: tracks,
        visibleFields: ['genre'],
        bulkOnChange: shared,
      }),
    )
    expect(first.find((s) => s.key === 'genre')?.onChange).toBe(
      second.find((s) => s.key === 'genre')?.onChange,
    )
  })
})

describe('buildFieldSpecs (single mode)', () => {
  it('reads each visible field off the open track and writes edits through setField', () => {
    const setField = vi.fn()
    const specs = buildFieldSpecs(
      params({ visibleFields: ['title'], singleOnChange: singleOnChangeFrom(setField) }),
    )
    expect(specs).toHaveLength(1)
    expect(specs[0]).toMatchObject({ key: 'title', value: 'Song', label: 'fields.title' })
    specs[0].onChange('New')
    expect(setField).toHaveBeenCalledWith('title', 'New')
  })

  it('flags a required field that is empty as invalid', () => {
    const specs = buildFieldSpecs(
      params({
        visibleFields: ['title', 'artist'],
        requiredFields: ['artist'],
        item: track('a', { title: 'Song', artist: '' }),
      }),
    )
    expect(specs.find((s) => s.key === 'title')?.invalid).toBe(false)
    expect(specs.find((s) => s.key === 'artist')?.invalid).toBe(true)
  })

  it('offers genre and grouping chips, and the detected bpm/key as suggestions', () => {
    const detectedBpm = { bpm: 127.6 } as BpmResult
    const detectedKey = { camelot: '8A', name: 'A minor' } as KeyResult
    const specs = buildFieldSpecs(params({ detectedBpm, detectedKey }))
    expect(specs.find((s) => s.key === 'genre')?.suggestions).toEqual(['Techno', 'House'])
    expect(specs.find((s) => s.key === 'grouping')?.suggestions).toEqual(['Bases', 'Vocals'])
    // The tag layer stores whole bpm, so the chip rounds.
    expect(specs.find((s) => s.key === 'bpm')?.suggestions).toEqual(['128'])
    expect(specs.find((s) => s.key === 'key')?.suggestions).toEqual(['8A'])
  })

  it('lets genre and grouping chips add tags, each with its own separator', () => {
    const specs = buildFieldSpecs(params())
    expect(specs.find((s) => s.key === 'genre')?.tagList).toBe(GENRE_TAGS)
    expect(specs.find((s) => s.key === 'grouping')?.tagList).toBe(GROUPING_TAGS)
    expect(specs.find((s) => s.key === 'bpm')?.tagList).toBeUndefined()
  })

  // A field the user added in Settings → Fields sits in the form where they put it, under
  // the name they gave it, holding what the file carries, and an edit reaches it by key.
  it('builds a custom field from its settings entry, value and writer', () => {
    const write = vi.fn()
    const specs = buildFieldSpecs(
      params({
        visibleFields: ['title', 'vinylCondition'],
        requiredFields: ['vinylCondition'],
        customFields: [{ key: 'vinylCondition', label: 'Estado del vinilo' }],
        customValues: { vinylCondition: '' },
        customOnChange: new Map([['vinylCondition', write]]),
      }),
    )
    expect(specs.map((s) => s.key)).toEqual(['title', 'vinylCondition'])
    const custom = specs[1]
    expect(custom).toMatchObject({ label: 'Estado del vinilo', value: '', invalid: true })
    custom.onChange('VG+')
    expect(write).toHaveBeenCalledWith('VG+')
  })

  it('offers the musical key name when that notation is selected', () => {
    const detectedKey = { camelot: '8A', name: 'A minor' } as KeyResult
    const specs = buildFieldSpecs(params({ detectedKey, keyNotation: 'musical' }))
    expect(specs.find((s) => s.key === 'key')?.suggestions).toEqual(['A minor'])
  })

  it('hands the title-format proposal to the title spec only', () => {
    // The ⋯ menu offers "apply the title format" as a whole-value rewrite, exactly
    // like the case transforms; only the title composes itself from the pattern.
    const specs = buildFieldSpecs(
      params({ visibleFields: ['title', 'artist'], titleFormatResult: '(A2) Song' }),
    )
    expect(specs.find((s) => s.key === 'title')?.formatResult).toBe('(A2) Song')
    expect(specs.find((s) => s.key === 'artist')?.formatResult).toBeUndefined()
  })

  it('exposes insert sources on the free-text fields only, never on structured or chip-driven ones', () => {
    // The { } menu composes one field out of others and fixes text case — that
    // only makes sense where the value IS free text (title, artist, comment,
    // publisher…). Structured single values (year, BPM, key, track numbers,
    // ISRC…) would happily swallow a pasted title, genre/grouping are picked
    // from their suggestion chips, and compilation is a checkbox flag.
    const specs = buildFieldSpecs(
      params({
        visibleFields: [
          'title',
          'publisher',
          'mixName',
          'year',
          'bpm',
          'key',
          'trackNumber',
          'genre',
          'grouping',
          'compilation',
        ],
      }),
    )
    for (const key of ['title', 'publisher', 'mixName']) {
      expect(specs.find((s) => s.key === key)?.insertSources, key).toHaveLength(1)
    }
    for (const key of ['year', 'bpm', 'key', 'trackNumber', 'genre', 'grouping', 'compilation']) {
      expect(specs.find((s) => s.key === key)?.insertSources, key).toBeUndefined()
    }
  })
})

describe('buildFieldSpecs (bulk mode)', () => {
  it('reads the selection common value and writes through onChangeAllMeta', () => {
    const onChangeAllMeta = vi.fn()
    const specs = buildFieldSpecs(
      params({
        isMulti: true,
        selectedTracks: [track('a', { genre: 'Techno' }), track('b', { genre: 'Techno' })],
        visibleFields: ['genre'],
        bulkOnChange: bulkOnChangeFrom(onChangeAllMeta),
      }),
    )
    const genre = specs.find((s) => s.key === 'genre')
    expect(genre?.value).toBe('Techno')
    genre?.onChange('House')
    expect(onChangeAllMeta).toHaveBeenCalledWith({ genre: 'House' })
  })

  it('shows a "multiple values" placeholder when the selection disagrees', () => {
    const specs = buildFieldSpecs(
      params({
        isMulti: true,
        selectedTracks: [track('a', { genre: 'Techno' }), track('b', { genre: 'House' })],
        visibleFields: ['genre'],
      }),
    )
    const genre = specs.find((s) => s.key === 'genre')
    expect(genre?.value).toBe('')
    expect(genre?.placeholder).toBe('editor.multipleValues')
  })

  // The placeholder vanishes from a screen reader's view once the field has focus and is
  // never read as the field's state, so the spec flags the disagreement for the Field to
  // describe in words; an empty value must not read as "these tracks have no genre".
  it('flags the field as mixed when the selection disagrees, and only then', () => {
    const build = (genres: string[]) =>
      buildFieldSpecs(
        params({
          isMulti: true,
          selectedTracks: genres.map((g, i) => track(String(i), { genre: g })),
          visibleFields: ['genre'],
        }),
      ).find((s) => s.key === 'genre')
    expect(build(['Techno', 'House'])?.mixed).toBe(true)
    expect(build(['Techno', 'Techno'])?.mixed).toBeFalsy()
  })

  // WHY: grouping is the one release-level field that legitimately differs inside a
  // release (vocal cuts vs. beats), so the bulk form hands it the tracks themselves
  // instead of a shared blank that a chip click would stamp on every one.
  it('hands grouping the selected tracks and a per-track writer in bulk mode', () => {
    const onChangeTracksMeta = vi.fn()
    const a = track('a', { grouping: 'Bases' })
    const b = track('b', { grouping: 'Vocals' })
    const specs = buildFieldSpecs(
      params({
        isMulti: true,
        selectedTracks: [a, b],
        visibleFields: ['grouping', 'genre'],
        onChangeTracksMeta,
      }),
    )
    const grouping = specs.find((s) => s.key === 'grouping')
    expect(grouping?.perTrack?.tracks).toEqual([a, b])
    expect(grouping?.perTrack?.onChangeTracks).toBe(onChangeTracksMeta)
    expect(grouping?.perTrack?.list).toBe(GROUPING_TAGS)
    expect(grouping?.placeholder).toBeUndefined()
  })

  // A user asked for every Discogs genre and style of a release, not just one. Genre now
  // works like grouping: several tags, and across a selection a chip marks all, some or
  // none of the tracks instead of stamping one value over what each track had.
  it('hands genre the selected tracks and its own tag list in bulk mode', () => {
    const onChangeTracksMeta = vi.fn()
    const a = track('a', { genre: 'Pop, Indie Pop' })
    const b = track('b', { genre: 'Pop' })
    const specs = buildFieldSpecs(
      params({
        isMulti: true,
        selectedTracks: [a, b],
        visibleFields: ['genre'],
        onChangeTracksMeta,
      }),
    )
    const genre = specs.find((s) => s.key === 'genre')
    expect(genre?.perTrack?.list).toBe(GENRE_TAGS)
    expect(genre?.perTrack?.tracks).toEqual([a, b])
  })

  // Across a selection a custom field reads like a managed one: the shared value, or the
  // "multiple values" hint when the tracks disagree, and an edit reaches every track.
  it('builds a custom field over the selection from each track own value', () => {
    const write = vi.fn()
    const vinyl = { key: 'vinylCondition', label: 'Estado del vinilo' }
    const a = { ...track('a'), foreignTags: [{ name: 'VINYLCONDITION', value: 'NM' }] }
    const b = { ...track('b', { custom: { vinylCondition: 'NM' } }) }
    const c = { ...track('c', { custom: { vinylCondition: 'VG' } }) }
    const build = (selectedTracks: TrackItem[]) =>
      buildFieldSpecs(
        params({
          isMulti: true,
          selectedTracks,
          visibleFields: ['vinylCondition'],
          customFields: [vinyl],
          customBulkOnChange: new Map([['vinylCondition', write]]),
        }),
      ).find((s) => s.key === 'vinylCondition')
    expect(build([a, b])).toMatchObject({ label: 'Estado del vinilo', value: 'NM' })
    expect(build([a, c])).toMatchObject({
      value: '',
      placeholder: 'editor.multipleValues',
      mixed: true,
    })
    build([a, b])?.onChange('VG+')
    expect(write).toHaveBeenCalledWith('VG+')
  })

  it('honours the visible-fields setting and drops non-bulk fields', () => {
    const specs = buildFieldSpecs(
      params({
        isMulti: true,
        selectedTracks: [track('a')],
        // 'title' is not a bulk field; 'grouping' is and is visible.
        visibleFields: ['title', 'grouping'],
      }),
    )
    expect(specs.map((s) => s.key)).toEqual(['grouping'])
  })
})
