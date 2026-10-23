import { describe, expect, it } from 'vitest'
import { RECENTLY_ADDED_ID } from '../../../shared/recentlyAdded'
import { revealStep } from './revealCue'

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
