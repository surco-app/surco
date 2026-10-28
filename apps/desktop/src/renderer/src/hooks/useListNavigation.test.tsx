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
