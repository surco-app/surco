// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { useWindowSnapshot } from './useWindowSnapshot'

describe('useWindowSnapshot', () => {
  const reportSnapshot = vi.fn<Api['reportSnapshot']>()

  beforeEach(() => {
    vi.useFakeTimers()
    reportSnapshot.mockClear()
    ;(window as unknown as { api: unknown }).api = { reportSnapshot }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports once on mount and every 30 s, reading the counts at send time', () => {
    let tracks = 10
    renderHook(() =>
      useWindowSnapshot(() => ({ listTracks: tracks, source: null, sourceTracks: null })),
    )
    expect(reportSnapshot).toHaveBeenCalledTimes(1)
    expect(reportSnapshot).toHaveBeenLastCalledWith({
      listTracks: 10,
      source: null,
      sourceTracks: null,
    })

    tracks = 20
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(reportSnapshot).toHaveBeenCalledTimes(2)
    expect(reportSnapshot).toHaveBeenLastCalledWith({
      listTracks: 20,
      source: null,
      sourceTracks: null,
    })
  })

  it('stops reporting after unmount', () => {
    const { unmount } = renderHook(() =>
      useWindowSnapshot(() => ({ listTracks: 1, source: null, sourceTracks: null })),
    )
    unmount()
    reportSnapshot.mockClear()
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(reportSnapshot).not.toHaveBeenCalled()
  })
})
