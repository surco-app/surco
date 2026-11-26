// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TrackItem } from '../types'
import { useListNavigation } from './useListNavigation'

const tracks = Array.from({ length: 1000 }, (_, i) => ({ id: `t${i}` }) as TrackItem)

function setup(selectedId: string | null, selectedMounted = true) {
  const rowEls = { current: new Map<string, HTMLButtonElement>() }
  const mounted = (id: string) => {
    const el = document.createElement('button')
    document.body.append(el)
    rowEls.current.set(id, el)
    return el
  }
  mounted('t0')
  if (selectedId && selectedMounted) mounted(selectedId)
  const revealRow = vi.fn((id: string) => {
    mounted(id)
  })
  const setSelection = vi.fn()
  const { result } = renderHook(() =>
    useListNavigation({
      visibleTracks: tracks,
      selectedId,
      selectedIds: new Set(selectedId ? [selectedId] : []),
      setSelection,
      continuousPlayback: false,
      playerVisible: false,
      playerTrack: null,
      closePlayer: vi.fn(),
      rowEls,
      listScrollRef: { current: document.createElement('div') },
      qualityFilterRef: { current: null },
      revealRowRef: { current: revealRow },
    }),
  )
  return { result, rowEls, revealRow, setSelection }
}

describe('useListNavigation on a list that mounts only the rows on screen', () => {
  it('brings the last row into view and focuses it on End, though it was not mounted', async () => {
    const { result, rowEls, revealRow, setSelection } = setup('t0')
    act(() => result.current.jumpSelection('last'))
    expect(setSelection).toHaveBeenCalledWith({ ids: ['t999'], anchor: 't999' })
    expect(revealRow).toHaveBeenCalledWith('t999')
    await waitFor(() => expect(rowEls.current.get('t999')).toHaveFocus())
  })

  it('jumps to a far track picked in the palette', async () => {
    const { result, rowEls, revealRow } = setup('t0')
    act(() => result.current.revealSelection('t640'))
    expect(revealRow).toHaveBeenCalledWith('t640')
    await waitFor(() => expect(rowEls.current.get('t640')).toHaveFocus())
  })

  it('scrolls back to the selected track after it was scrolled far away', () => {
    const { result, revealRow } = setup('t500', false)
    act(() => result.current.scrollToSelected())
    expect(revealRow).toHaveBeenCalledWith('t500')
  })
})

describe('useListNavigation after a keyboard range', () => {
  function rangeSetup(selectedIds: string[], focusedId: string) {
    const rowEls = { current: new Map<string, HTMLButtonElement>() }
    for (const t of tracks.slice(0, 10)) {
      const el = document.createElement('button')
      document.body.append(el)
      rowEls.current.set(t.id, el)
    }
    rowEls.current.get(focusedId)?.focus()
    const setSelection = vi.fn()
    const { result } = renderHook(() =>
      useListNavigation({
        visibleTracks: tracks,
        selectedId: selectedIds[0],
        selectedIds: new Set(selectedIds),
        setSelection,
        continuousPlayback: false,
        playerVisible: false,
        playerTrack: null,
        closePlayer: vi.fn(),
        rowEls,
        listScrollRef: { current: document.createElement('div') },
        qualityFilterRef: { current: null },
      }),
    )
    return { result, setSelection }
  }

  // Shift+↓ grew the range down to the focused row; a plain ↓ then carries on past that end,
  // as in Finder and Music, instead of throwing the user back next to where the range began.
  it('steps a plain Down from the focused end of the range, not from its anchor', () => {
    const { result, setSelection } = rangeSetup(['t2', 't3', 't4', 't5'], 't5')
    act(() => result.current.moveSelection(1))
    expect(setSelection).toHaveBeenCalledWith({ ids: ['t6'], anchor: 't6' })
  })

  it('steps a plain Up from the focused end of the range, not from its anchor', () => {
    const { result, setSelection } = rangeSetup(['t5', 't4', 't3', 't2'], 't2')
    act(() => result.current.moveSelection(-1))
    expect(setSelection).toHaveBeenCalledWith({ ids: ['t1'], anchor: 't1' })
  })

  // Focus left on a row outside the selection says nothing about where the user is: the
  // selected track stays the starting point.
  it('steps from the selected track when the focused row is not selected', () => {
    const { result, setSelection } = rangeSetup(['t2'], 't7')
    act(() => result.current.moveSelection(1))
    expect(setSelection).toHaveBeenCalledWith({ ids: ['t3'], anchor: 't3' })
  })
})

describe('useListNavigation across renders', () => {
  // App re-renders on every metadata flush and runs an effect keyed on scrollToSelected,
  // and memoized children take these as props; a new function each render re-ran that
  // effect and redrew those children for nothing. Each call still reads the latest list.
  it('keeps the same functions across renders and acts on the latest selection', () => {
    const revealRow = vi.fn()
    const nav = (selectedId: string) =>
      useListNavigation({
        visibleTracks: tracks,
        selectedId,
        selectedIds: new Set([selectedId]),
        setSelection: vi.fn(),
        continuousPlayback: false,
        playerVisible: false,
        playerTrack: null,
        closePlayer: vi.fn(),
        rowEls: { current: new Map<string, HTMLButtonElement>() },
        listScrollRef: { current: document.createElement('div') },
        qualityFilterRef: { current: null },
        revealRowRef: { current: revealRow },
      })
    const { result, rerender } = renderHook(({ id }) => nav(id), { initialProps: { id: 't1' } })
    const first = result.current
    rerender({ id: 't2' })
    expect(result.current.scrollToSelected).toBe(first.scrollToSelected)
    expect(result.current.moveSelection).toBe(first.moveSelection)
    expect(result.current.jumpSelection).toBe(first.jumpSelection)
    expect(result.current.pageSelection).toBe(first.pageSelection)
    expect(result.current.revealSelection).toBe(first.revealSelection)
    expect(result.current.onTrackEnded).toBe(first.onTrackEnded)
    act(() => first.scrollToSelected())
    expect(revealRow).toHaveBeenCalledWith('t2')
  })
})

describe('useListNavigation paging', () => {
  function pageSetup(selectedId: string | null, rowHeight: number, viewport: number) {
    const rowEls = { current: new Map<string, HTMLButtonElement>() }
    for (const t of tracks.slice(0, 60)) {
      const el = document.createElement('button')
      el.getBoundingClientRect = () => new DOMRect(0, 0, 300, rowHeight)
      document.body.append(el)
      rowEls.current.set(t.id, el)
    }
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientHeight', { value: viewport })
    const setSelection = vi.fn()
    const { result } = renderHook(() =>
      useListNavigation({
        visibleTracks: tracks,
        selectedId,
        selectedIds: new Set(selectedId ? [selectedId] : []),
        setSelection,
        continuousPlayback: false,
        playerVisible: false,
        playerTrack: null,
        closePlayer: vi.fn(),
        rowEls,
        listScrollRef: { current: container },
        qualityFilterRef: { current: null },
      }),
    )
    return { result, setSelection }
  }

  // Page Down must land one screen further minus a row of overlap, measured from the real
  // row height: 400 px of pane over 36 px rows plus the 4 px gap fit 10 rows, so the DJ
  // keeps the last row of the old page in sight and moves 9.
  it('moves Page Down by the rows that fit on screen, keeping one row of overlap', () => {
    const { result, setSelection } = pageSetup('t10', 36, 400)
    act(() => result.current.pageSelection(1))
    expect(setSelection).toHaveBeenLastCalledWith({ ids: ['t19'], anchor: 't19' })
  })

  it('moves Page Up the same page back toward the top', () => {
    const { result, setSelection } = pageSetup('t30', 36, 400)
    act(() => result.current.pageSelection(-1))
    expect(setSelection).toHaveBeenLastCalledWith({ ids: ['t21'], anchor: 't21' })
  })

  // Compact density halves the row; a guessed constant would page past rows the DJ never saw.
  it('pages further when the rows are shorter, because more of them fit', () => {
    const { result, setSelection } = pageSetup('t0', 16, 400)
    act(() => result.current.pageSelection(1))
    expect(setSelection).toHaveBeenLastCalledWith({ ids: ['t19'], anchor: 't19' })
  })

  // The list mounts only the rows on screen, so the selected row may be gone after a long
  // scroll; another rendered row still gives the height, or Page Down would crawl one row.
  it('measures another rendered row when the selected one is not mounted', () => {
    const { result, setSelection } = pageSetup('t100', 36, 400)
    act(() => result.current.pageSelection(1))
    expect(setSelection).toHaveBeenLastCalledWith({ ids: ['t109'], anchor: 't109' })
  })
})
