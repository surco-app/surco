import { describe, expect, it, vi } from 'vitest'
import type { BpmResult, KeyResult, TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { type BuildFieldSpecsParams, buildFieldSpecs } from './fieldSpecs'

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
    detectedBpm: undefined,
    detectedKey: undefined,
    keyNotation: 'camelot',
    insertSources: [{ key: 'artist', label: 'Artist', value: 'X' }],
    albumCleanResult: undefined,
    tr,
    setField: vi.fn(),
    onChangeAllMeta: vi.fn(),
    ...over,
  }
}

describe('buildFieldSpecs (single mode)', () => {
  it('reads each visible field off the open track and writes edits through setField', () => {
    const setField = vi.fn()
    const specs = buildFieldSpecs(params({ visibleFields: ['title'], setField }))
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

  it('offers the musical key name when that notation is selected', () => {
    const detectedKey = { camelot: '8A', name: 'A minor' } as KeyResult
    const specs = buildFieldSpecs(params({ detectedKey, keyNotation: 'musical' }))
    expect(specs.find((s) => s.key === 'key')?.suggestions).toEqual(['A minor'])
  })

  it('exposes insert sources on every text field, but never on the compilation flag', () => {
    // The { } menu is how any field borrows another field's value (the year into
    // the title, the title into the comment…); gating it to a handful of fields
    // made the rest look like they simply lacked the feature. compilation stays
    // out — it is a checkbox flag, not text a value could be inserted into.
    const specs = buildFieldSpecs(
      params({ visibleFields: ['title', 'bpm', 'year', 'compilation'] }),
    )
    expect(specs.find((s) => s.key === 'title')?.insertSources).toHaveLength(1)
    expect(specs.find((s) => s.key === 'bpm')?.insertSources).toHaveLength(1)
    expect(specs.find((s) => s.key === 'year')?.insertSources).toHaveLength(1)
    expect(specs.find((s) => s.key === 'compilation')?.insertSources).toBeUndefined()
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
        onChangeAllMeta,
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
