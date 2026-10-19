import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { SourceNode } from '../../../shared/types'
import type { TrackItem } from '../types'
import { isStale, trackSignature } from './dirty'
import {
  bulkPlaylistState,
  canCreate,
  chipLabel,
  clearWrittenPlaylists,
  discardPlaylistEdits,
  effectivePlaylists,
  matchingOptions,
  playlistOptions,
  playlistsEdit,
  withTarget,
} from './rekordboxPlaylists'
import { hasStagedEdits } from './sessionEdits'

function track(over: Partial<TrackItem> & { id: string }): TrackItem {
  return {
    inputPath: `/m/${over.id}.wav`,
    fileName: `${over.id}.wav`,
    listLabel: over.id,
    query: '',
    status: 'idle',
    meta: emptyMetadata(),
    ...over,
  }
}

const TREE: SourceNode[] = [
  {
    id: '1000',
    name: 'BOLOS',
    kind: 'folder',
    count: 2,
    children: [
      { id: '1001', name: 'Bolos de verano', kind: 'playlist', count: 3 },
      {
        id: '1100',
        name: 'FIJAS',
        kind: 'folder',
        count: 1,
        children: [{ id: '1101', name: 'Todas', kind: 'playlist', count: 9 }],
      },
    ],
  },
  { id: '2000', name: 'Todas', kind: 'playlist', count: 40 },
  { id: '3000', name: 'Makina', kind: 'playlist', count: 10 },
]
const OPTIONS = playlistOptions(TREE)

describe('playlistOptions', () => {
  it('lists playlists only, each with the folders above it, because the collection repeats names and only the folder path tells them apart', () => {
    expect(OPTIONS).toEqual([
      { id: '1001', name: 'Bolos de verano', path: 'BOLOS' },
      { id: '1101', name: 'Todas', path: 'BOLOS › FIJAS' },
      { id: '2000', name: 'Todas', path: '' },
      { id: '3000', name: 'Makina', path: '' },
    ])
  })
})

describe('matchingOptions', () => {
  it('filters by name ignoring case and accents, without the chosen ones', () => {
    expect(matchingOptions(OPTIONS, 'MAKÍNA', []).map((o) => o.id)).toEqual(['3000'])
    expect(
      matchingOptions(OPTIONS, 'todas', [{ id: '2000', name: 'Todas' }]).map((o) => o.id),
    ).toEqual(['1101'])
  })

  it('hides the root playlist an id-less chosen name already resolves to', () => {
    expect(matchingOptions(OPTIONS, 'makina', [{ name: 'Makina' }]).map((o) => o.id)).toEqual([])
  })

  it('needs every word of the query in the folders or the name, so a path narrows identical names', () => {
    expect(matchingOptions(OPTIONS, 'bolos fijas', []).map((o) => o.id)).toEqual(['1101'])
    expect(matchingOptions(OPTIONS, '  TODAS   fíjas ', []).map((o) => o.id)).toEqual(['1101'])
    expect(matchingOptions(OPTIONS, 'fijas makina', []).map((o) => o.id)).toEqual([])
  })

  it('matches a folder name alone, listing everything inside it', () => {
    expect(matchingOptions(OPTIONS, 'bolos', []).map((o) => o.id)).toEqual(['1001', '1101'])
  })
})

describe('chipLabel', () => {
  it('adds the parent folder only when the name repeats in the tree', () => {
    expect(chipLabel(OPTIONS, { id: '1101', name: 'Todas' })).toBe('FIJAS › Todas')
    expect(chipLabel(OPTIONS, { id: '2000', name: 'Todas' })).toBe('Todas')
    expect(chipLabel(OPTIONS, { id: '3000', name: 'Makina' })).toBe('Makina')
    expect(chipLabel(OPTIONS, { name: 'Nueva' })).toBe('Nueva')
  })
})

describe('canCreate', () => {
  it('offers a new name only when no playlist is called exactly that, as the spec offers Crear playlist', () => {
    expect(canCreate(OPTIONS, 'Makina', [])).toBe(false)
    expect(canCreate(OPTIONS, 'makina', [])).toBe(true)
    expect(canCreate(OPTIONS, '  ', [])).toBe(false)
    expect(canCreate(OPTIONS, 'Cierre', [{ name: 'Cierre' }])).toBe(false)
  })
})

describe('effectivePlaylists', () => {
  it('starts from what rekordbox holds for the file, so the untouched field shows where the track is today', () => {
    const t = track({ id: 'a', inputPath: '/m/a.wav' })
    expect(effectivePlaylists(t, { '/m/a.wav': ['3000'] }, OPTIONS)).toEqual([
      { id: '3000', name: 'Makina' },
    ])
  })

  it('follows the converted file, where the entry now points', () => {
    const t = track({ id: 'a', inputPath: '/m/a.mp3', outputPath: '/m/a.wav' })
    expect(effectivePlaylists(t, { '/m/a.wav': ['3000'] }, OPTIONS)).toEqual([
      { id: '3000', name: 'Makina' },
    ])
  })

  it('uses the edit once the user touched the field', () => {
    const t = track({ id: 'a', inputPath: '/m/a.wav', rekordboxPlaylists: [{ name: 'Cierre' }] })
    expect(effectivePlaylists(t, { '/m/a.wav': ['3000'] }, OPTIONS)).toEqual([{ name: 'Cierre' }])
  })

  it('resolves an id-less target to the root playlist of that name, as the main process does', () => {
    const t = track({ id: 'a', inputPath: '/m/a.wav', rekordboxPlaylists: [{ name: 'Makina' }] })
    expect(effectivePlaylists(t, {}, OPTIONS)).toEqual([{ id: '3000', name: 'Makina' }])
  })

  it('does not resolve an id-less target to a playlist inside a folder', () => {
    const t = track({
      id: 'a',
      inputPath: '/m/a.wav',
      rekordboxPlaylists: [{ name: 'Bolos de verano' }],
    })
    expect(effectivePlaylists(t, {}, OPTIONS)).toEqual([{ name: 'Bolos de verano' }])
  })

  it('answers nothing while options or membership are still loading, so a pick can never shrink the set', () => {
    const t = track({ id: 'a', inputPath: '/m/a.wav' })
    expect(effectivePlaylists(t, undefined, OPTIONS)).toBeUndefined()
    expect(effectivePlaylists(t, {}, undefined)).toBeUndefined()
  })
})

describe('bulk', () => {
  const a = track({ id: 'a', inputPath: '/m/a.wav' })
  const b = track({ id: 'b', inputPath: '/m/b.wav' })
  const membership = { '/m/a.wav': ['3000', '2000'], '/m/b.wav': ['3000'] }

  it('says which playlists every track is in and which only some', () => {
    expect(bulkPlaylistState([a, b], membership, OPTIONS)).toEqual([
      { target: { id: '3000', name: 'Makina' }, state: 'all' },
      { target: { id: '2000', name: 'Todas' }, state: 'some' },
    ])
  })

  it('completes a half token for every track, and removes it from all', () => {
    const todas = { id: '2000', name: 'Todas' }
    expect(withTarget([a, b], membership, OPTIONS, todas, true)).toEqual([
      {
        id: 'a',
        rekordboxPlaylists: [{ id: '3000', name: 'Makina' }, todas],
        rekordboxPlaylistsBase: ['3000', '2000'],
      },
      {
        id: 'b',
        rekordboxPlaylists: [{ id: '3000', name: 'Makina' }, todas],
        rekordboxPlaylistsBase: ['3000'],
      },
    ])
    expect(withTarget([a, b], membership, OPTIONS, todas, false)).toEqual([
      {
        id: 'a',
        rekordboxPlaylists: [{ id: '3000', name: 'Makina' }],
        rekordboxPlaylistsBase: ['3000', '2000'],
      },
      {
        id: 'b',
        rekordboxPlaylists: [{ id: '3000', name: 'Makina' }],
        rekordboxPlaylistsBase: ['3000'],
      },
    ])
  })

  it('answers nothing while options or membership are still loading, so no pick shrinks any track', () => {
    const todas = { id: '2000', name: 'Todas' }
    expect(bulkPlaylistState([a, b], undefined, OPTIONS)).toBeUndefined()
    expect(bulkPlaylistState([a, b], membership, undefined)).toBeUndefined()
    expect(withTarget([a, b], undefined, OPTIONS, todas, true)).toBeUndefined()
    expect(withTarget([a, b], membership, undefined, todas, true)).toBeUndefined()
  })
})

describe('playlistsEdit', () => {
  it('records the membership shown at the first edit, so the queue judges removals by what the user saw', () => {
    const t = track({ id: 'a', inputPath: '/m/a.wav' })
    expect(playlistsEdit(t, { '/m/a.wav': ['3000'] }, [{ name: 'Fijas' }])).toEqual({
      rekordboxPlaylists: [{ name: 'Fijas' }],
      rekordboxPlaylistsBase: ['3000'],
    })
  })

  it('keeps the first base on later edits, so a refreshed view does not hide what changed in between', () => {
    const t = track({
      id: 'a',
      inputPath: '/m/a.wav',
      rekordboxPlaylists: [{ name: 'Fijas' }],
      rekordboxPlaylistsBase: ['3000'],
    })
    expect(
      playlistsEdit(t, { '/m/a.wav': ['3000', '2000'] }, [{ name: 'Otra' }]).rekordboxPlaylistsBase,
    ).toEqual(['3000'])
  })

  it('records an empty base for a track rekordbox does not hold', () => {
    const t = track({ id: 'a', inputPath: '/m/a.wav' })
    expect(playlistsEdit(t, {}, [{ name: 'Fijas' }]).rekordboxPlaylistsBase).toEqual([])
  })
})

describe('discardPlaylistEdits', () => {
  const target = [{ id: '1001', name: 'Bolos' }]
  const converted = (over: Partial<TrackItem> = {}): TrackItem => {
    const base = track({
      id: 'a',
      status: 'done',
      outputPath: '/out/a.aiff',
      rekordboxPlaylists: target,
      ...over,
    })
    const signature = trackSignature(base)
    return { ...base, processedSignature: signature, diskSignature: signature }
  }

  it('clears a converted row matched by its output path without making it stale or unsaved', () => {
    const [out] = discardPlaylistEdits(
      [converted({ rekordboxPlaylistsBase: ['1001'] })],
      ['/out/a.aiff'],
    )
    expect(out.rekordboxPlaylists).toBeUndefined()
    expect(out.rekordboxPlaylistsBase).toBeUndefined()
    expect(isStale(out)).toBe(false)
    expect(hasStagedEdits(out)).toBe(false)
  })

  it('keeps the other staged edits and their staleness', () => {
    const edited = converted()
    const staged = {
      ...edited,
      meta: { ...edited.meta, title: 'New title' },
    }
    const [out] = discardPlaylistEdits([staged], ['/out/a.aiff'])
    expect(out.meta.title).toBe('New title')
    expect(isStale(out)).toBe(true)
  })

  it('leaves unmatched rows untouched', () => {
    const rows = [converted(), track({ id: 'b' })]
    const out = discardPlaylistEdits(rows, ['/nowhere.wav'])
    expect(out[0]).toBe(rows[0])
    expect(out[1]).toBe(rows[1])
  })
})

describe('clearWrittenPlaylists', () => {
  const typed = [{ name: 'Surco prueba A' }]
  const written = (over: Partial<TrackItem> = {}): TrackItem => {
    const base = track({
      id: 'a',
      status: 'done',
      outputPath: '/out/a.aiff',
      rekordboxPlaylists: typed,
      ...over,
    })
    const signature = trackSignature(base)
    return { ...base, processedSignature: signature, diskSignature: signature }
  }

  it('clears a field the collection now holds without making the row stale or unsaved, so a later rename cannot orphan it', () => {
    const [out] = clearWrittenPlaylists(
      [written({ rekordboxPlaylistsBase: [] })],
      [{ path: '/out/a.aiff', wanted: [{ name: 'Surco prueba A' }] }],
    )
    expect(out.rekordboxPlaylists).toBeUndefined()
    expect(out.rekordboxPlaylistsBase).toBeUndefined()
    expect(isStale(out)).toBe(false)
    expect(hasStagedEdits(out)).toBe(false)
  })

  it('compares the raw targets whatever their order', () => {
    const two = [{ id: '1', name: 'A' }, { name: 'B' }]
    const [out] = clearWrittenPlaylists(
      [written({ rekordboxPlaylists: two })],
      [{ path: '/out/a.aiff', wanted: [{ name: 'B' }, { id: '1', name: 'A' }] }],
    )
    expect(out.rekordboxPlaylists).toBeUndefined()
  })

  it('keeps an edit made after queueing because it was never written', () => {
    const rows = [written({ rekordboxPlaylists: [{ name: 'Surco prueba A' }, { name: 'Otra' }] })]
    const out = clearWrittenPlaylists(rows, [
      { path: '/out/a.aiff', wanted: [{ name: 'Surco prueba A' }] },
    ])
    expect(out[0]).toBe(rows[0])
  })
})
