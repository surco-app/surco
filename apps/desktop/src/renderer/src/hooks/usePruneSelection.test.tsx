// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { useLayoutEffect, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { PlaylistSource } from '../../../shared/types'
import type { Selection } from '../lib/selection'
import { EMPTY_FILTER, type FilterSelection } from '../lib/triage'
import { usePruneSelection } from './usePruneSelection'

interface Props {
  filterSelection: FilterSelection
  deferredSearch: string
  source: PlaylistSource | null
  playlistIds: readonly string[] | undefined
  visible: string[]
  selection: Selection
}

const rows = (ids: string[]) => ids.map((id) => ({ id }))

function setup(initial: Props) {
  const setSelectionState = vi.fn<(next: Selection) => void>()
  const hook = renderHook(
    (p: Props) =>
      usePruneSelection({
        filterSelection: p.filterSelection,
        deferredSearch: p.deferredSearch,
        source: p.source,
        playlistIds: p.playlistIds,
        visibleTracks: rows(p.visible),
        selection: p.selection,
        selectedId: p.selection.anchor,
        setSelectionState,
      }),
    { initialProps: initial },
  )
  return { ...hook, setSelectionState }
}

function setupCommitted(initial: Props) {
  const committed: Selection[] = []
  const hook = renderHook(
    (p: Props) => {
      const [selection, setSelectionState] = useState(initial.selection)
      usePruneSelection({
        filterSelection: p.filterSelection,
        deferredSearch: p.deferredSearch,
        source: p.source,
        playlistIds: p.playlistIds,
        visibleTracks: rows(p.visible),
        selection,
        selectedId: selection.anchor,
        setSelectionState,
      })
      useLayoutEffect(() => {
        committed.push(selection)
      })
      return selection
    },
    { initialProps: initial },
  )
  committed.length = 0
  return { ...hook, committed }
}

const base: Props = {
  filterSelection: EMPTY_FILTER,
  deferredSearch: '',
  source: null,
  playlistIds: undefined,
  visible: ['a', 'b', 'c'],
  selection: { ids: ['a', 'b'], anchor: 'b' },
}

describe('usePruneSelection', () => {
  it('leaves the selection alone while nothing that hides rows changed, so a re-render never moves it', () => {
    const { rerender, setSelectionState } = setup(base)
    rerender({ ...base, visible: ['a'] })
    expect(setSelectionState).not.toHaveBeenCalled()
  })

  it('drops the selected rows a search hides, so trashing the selection never reaches rows out of sight', () => {
    const { rerender, setSelectionState } = setup(base)
    rerender({ ...base, deferredSearch: 'x', visible: ['a', 'c'] })
    expect(setSelectionState).toHaveBeenCalledWith({ ids: ['a'], anchor: 'a' })
  })

  it('keeps the selection when a search hides all of it, so typing does not jump the editor on every keystroke', () => {
    const { rerender, setSelectionState } = setup(base)
    rerender({ ...base, deferredSearch: 'x', visible: ['c'] })
    expect(setSelectionState).not.toHaveBeenCalled()
  })

  it('falls to the first visible track when a filter hides the whole selection, so the editor shows a row on screen', () => {
    const { rerender, setSelectionState } = setup(base)
    rerender({
      ...base,
      filterSelection: { ...EMPTY_FILTER, attention: 'badGrid' },
      visible: ['c'],
    })
    expect(setSelectionState).toHaveBeenCalledWith({ ids: ['c'], anchor: 'c' })
  })

  it('prunes against the new source, so the kept selection cannot reach rows the switch left behind', () => {
    const { rerender, setSelectionState } = setup(base)
    rerender({ ...base, source: 'rekordbox', visible: ['b'] })
    expect(setSelectionState).toHaveBeenCalledWith({ ids: ['b'], anchor: 'b' })
  })

  it('prunes when the playlist rows arrive, since only then are its own rows on screen to prune against', () => {
    const { rerender, setSelectionState } = setup(base)
    rerender({ ...base, playlistIds: ['a'], visible: ['a'] })
    expect(setSelectionState).toHaveBeenCalledWith({ ids: ['a'], anchor: 'a' })
  })

  it('prunes in the same render the search narrows the list, so a selection reaching hidden rows is never on screen for a frame', () => {
    const { result, rerender, committed } = setupCommitted(base)
    rerender({ ...base, deferredSearch: 'x', visible: ['a', 'c'] })
    expect(result.current).toEqual({ ids: ['a'], anchor: 'a' })
    expect(committed).toEqual([{ ids: ['a'], anchor: 'a' }])
  })
})
