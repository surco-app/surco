import { describe, expect, it } from 'vitest'
import { RECENTLY_ADDED_ID } from '../../../shared/recentlyAdded'
import type { SourcePlaylistEntry } from '../../../shared/types'
import type { TrackItem } from '../types'
import { revealableIn, revealStep, revealTrackStep } from './revealCue'

const rows = new Map([
  ['row-1', '101'],
  ['row-2', '103'],
])

describe('revealStep', () => {
  it('goes to rekordbox first, wherever the DJ was when the notice came', () => {
    expect(
      revealStep('103', {
        source: null,
        playlistId: null,
        loading: false,
        listed: undefined,
        contentOf: undefined,
      }),
    ).toEqual({ do: 'source' })
  })

  it('opens Recently added next, since a track Surco gave its own grid has only just reached rekordbox', () => {
    expect(
      revealStep('103', {
        source: 'rekordbox',
        playlistId: 'p1',
        loading: false,
        listed: ['101', '103'],
        contentOf: rows,
      }),
    ).toEqual({ do: 'playlist' })
  })

  it('waits for the rows, because the previous playlist is still on screen while the new one loads', () => {
    expect(
      revealStep('103', {
        source: 'rekordbox',
        playlistId: RECENTLY_ADDED_ID,
        loading: true,
        listed: ['101', '103'],
        contentOf: rows,
      }),
    ).toEqual({ do: 'wait' })
    expect(
      revealStep('103', {
        source: 'rekordbox',
        playlistId: RECENTLY_ADDED_ID,
        loading: false,
        listed: undefined,
        contentOf: undefined,
      }),
    ).toEqual({ do: 'wait' })
  })

  it('waits while the track is in the playlist but its row is not on the list yet', () => {
    expect(
      revealStep('103', {
        source: 'rekordbox',
        playlistId: RECENTLY_ADDED_ID,
        loading: false,
        listed: ['101', '103'],
        contentOf: new Map(),
      }),
    ).toEqual({ do: 'wait' })
  })

  it('selects the row of that track once it is listed', () => {
    expect(
      revealStep('103', {
        source: 'rekordbox',
        playlistId: RECENTLY_ADDED_ID,
        loading: false,
        listed: ['101', '103'],
        contentOf: rows,
      }),
    ).toEqual({ do: 'select', id: 'row-2' })
  })

  it('gives up when the track is no longer among the recent ones, leaving the list open', () => {
    expect(
      revealStep('999', {
        source: 'rekordbox',
        playlistId: RECENTLY_ADDED_ID,
        loading: false,
        listed: ['101', '103'],
        contentOf: rows,
      }),
    ).toEqual({ do: 'give-up' })
  })
})

describe('revealTrackStep', () => {
  const view = {
    source: 'rekordbox' as const,
    playlistId: RECENTLY_ADDED_ID,
    loading: false,
    shown: ['t1', 't2'],
  }

  it('goes to the library the button names, whichever tab was open', () => {
    expect(revealTrackStep('rekordbox', 't2', { ...view, source: 'traktor' })).toEqual({
      do: 'source',
    })
    expect(revealTrackStep('rekordbox', 't2', { ...view, source: null })).toEqual({
      do: 'source',
    })
  })

  it('opens Recently added, the one list a just converted track is sure to be in', () => {
    expect(revealTrackStep('rekordbox', 't2', { ...view, playlistId: 'p1' })).toEqual({
      do: 'playlist',
    })
  })

  it('waits while the list loads, because the previous playlist is still on screen', () => {
    expect(revealTrackStep('rekordbox', 't2', { ...view, loading: true })).toEqual({ do: 'wait' })
    expect(revealTrackStep('rekordbox', 't2', { ...view, shown: undefined })).toEqual({
      do: 'wait',
    })
  })

  it('selects the converted track, which the list shows under its own row', () => {
    expect(revealTrackStep('rekordbox', 't2', view)).toEqual({ do: 'select', id: 't2' })
  })

  it('gives up when the track is not there, leaving the list open', () => {
    expect(revealTrackStep('rekordbox', 't9', view)).toEqual({ do: 'give-up' })
  })
})

describe('revealableIn', () => {
  const track = (over: Partial<TrackItem> = {}): TrackItem =>
    ({
      id: 't1',
      inputPath: '/in/Love Ya.flac',
      outputPath: '/out/Love Ya.aiff',
      rekordboxPlaylists: [{ id: 'p1', name: 'Bases' }],
      ...over,
    }) as TrackItem
  const entry = (path: string): SourcePlaylistEntry => ({ path, separator: false, meta: {} })

  it('offers rekordbox once the converted file is among its recently added', () => {
    expect(revealableIn(track(), { rekordbox: [entry('/out/Love Ya.aiff')] })).toEqual([
      'rekordbox',
    ])
  })

  it('offers nothing while the file has not reached rekordbox, as when it waits for rekordbox to close', () => {
    expect(revealableIn(track(), { rekordbox: [entry('/out/Other.aiff')] })).toEqual([])
    expect(revealableIn(track(), {})).toEqual([])
  })

  it('offers nothing when no rekordbox playlist was picked, since then the DJ did not ask for rekordbox', () => {
    const recent = { rekordbox: [entry('/out/Love Ya.aiff')] }
    expect(revealableIn(track({ rekordboxPlaylists: undefined }), recent)).toEqual([])
    expect(revealableIn(track({ rekordboxPlaylists: [] }), recent)).toEqual([])
  })
})
