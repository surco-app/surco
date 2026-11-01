// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TrackItem } from '../types'
import { usePlaylistReadPriority } from './usePlaylistReadPriority'

afterEach(cleanup)

const row = (id: string, loadingMeta = true) => ({ id, loadingMeta }) as TrackItem

// Measured 01/11 on a 2041-track Music library: with All tracks still reading, the 14 rows of
// Acapellas below the fold waited 12 s behind the whole library, though only the rows on
// screen were moved ahead. The open playlist is what the user is about to scroll through.
describe('usePlaylistReadPriority', () => {
  function render(playlistId: string | null, rows: TrackItem[]) {
    const prioritizeReads = vi.fn()
    const hook = renderHook(
      ({ id, tracks }) => usePlaylistReadPriority(id, tracks, prioritizeReads),
      { initialProps: { id: playlistId, tracks: rows } },
    )
    return { ...hook, prioritizeReads }
  }

  it('moves every unread row of the opened playlist ahead, in list order', () => {
    const { prioritizeReads } = render('acapellas', [row('a'), row('b', false), row('c')])

    expect(prioritizeReads).toHaveBeenCalledExactlyOnceWith(['a', 'c'])
  })

  it('asks once per opening, not on every read that lands', () => {
    const { rerender, prioritizeReads } = render('acapellas', [row('a'), row('c')])

    rerender({ id: 'acapellas', tracks: [row('a', false), row('c')] })

    expect(prioritizeReads).toHaveBeenCalledOnce()
  })

  it('waits for the rows of a playlist whose entries arrive after it opens', () => {
    const { rerender, prioritizeReads } = render('house', [])
    expect(prioritizeReads).not.toHaveBeenCalled()

    rerender({ id: 'house', tracks: [row('h')] })

    expect(prioritizeReads).toHaveBeenCalledExactlyOnceWith(['h'])
  })

  it('moves the next playlist ahead when the user switches', () => {
    const { rerender, prioritizeReads } = render('acapellas', [row('a')])

    rerender({ id: 'house', tracks: [row('h')] })

    expect(prioritizeReads).toHaveBeenLastCalledWith(['h'])
  })
})
