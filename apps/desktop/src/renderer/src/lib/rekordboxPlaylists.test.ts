import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { SourceNode } from '../../../shared/types'
import type { TrackItem } from '../types'
import {
  bulkPlaylistState,
  canCreate,
  effectivePlaylists,
  isPlaylistsPending,
  matchingOptions,
  playlistOptions,
  withTarget,
} from './rekordboxPlaylists'

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

describe('isPlaylistsPending', () => {
  it('is pending until rekordbox holds exactly the wanted set, shown as hollow dots', () => {
    const want = track({
      id: 'a',
      inputPath: '/m/a.wav',
      rekordboxPlaylists: [{ id: '3000', name: 'Makina' }],
    })
    expect(isPlaylistsPending(want, {}, OPTIONS)).toBe(true)
    expect(isPlaylistsPending(want, { '/m/a.wav': ['3000'] }, OPTIONS)).toBe(false)
    expect(isPlaylistsPending(want, { '/m/a.wav': ['3000', '2000'] }, OPTIONS)).toBe(true)
    expect(isPlaylistsPending(track({ id: 'b' }), {}, OPTIONS)).toBe(false)
  })

  it('is not pending for an id-less target when a root playlist of that name already holds the track', () => {
    const t = track({ id: 'a', inputPath: '/m/a.wav', rekordboxPlaylists: [{ name: 'Makina' }] })
    expect(isPlaylistsPending(t, { '/m/a.wav': ['3000'] }, OPTIONS)).toBe(false)
  })

  it('stays pending for an id-less target with no root playlist of that name', () => {
    const t = track({ id: 'a', inputPath: '/m/a.wav', rekordboxPlaylists: [{ name: 'Cierre' }] })
    expect(isPlaylistsPending(t, {}, OPTIONS)).toBe(true)
  })

  it('answers nothing while options or membership are still loading', () => {
    const t = track({ id: 'a', rekordboxPlaylists: [{ name: 'Makina' }] })
    expect(isPlaylistsPending(t, undefined, OPTIONS)).toBeUndefined()
    expect(isPlaylistsPending(t, {}, undefined)).toBeUndefined()
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
      { id: 'a', rekordboxPlaylists: [{ id: '3000', name: 'Makina' }, todas] },
      { id: 'b', rekordboxPlaylists: [{ id: '3000', name: 'Makina' }, todas] },
    ])
    expect(withTarget([a, b], membership, OPTIONS, todas, false)).toEqual([
      { id: 'a', rekordboxPlaylists: [{ id: '3000', name: 'Makina' }] },
      { id: 'b', rekordboxPlaylists: [{ id: '3000', name: 'Makina' }] },
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
