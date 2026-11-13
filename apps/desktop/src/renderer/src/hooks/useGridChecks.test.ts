// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, configure, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode, useMemo } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { needsGridFix } from '../../../shared/gridCheck'
import {
  type EditableGrid,
  editableGridOf,
  type GridFit,
  gridBeats,
} from '../../../shared/gridEdit'
import type { TrackCues } from '../../../shared/types'
import { startDraft } from '../lib/cueDraft'
import { cueDraftKey, keepDraft, resetCueSession } from '../lib/cueSession'
import { installApi } from '../test/api'
import { resetGridChecks, useGridChecks } from './useGridChecks'
import { trackCuesQuery } from './useTrackCues'

// A burst of measures is told at most once a second, so the counts land within two.
configure({ asyncUtilTimeout: 2000 })

afterEach(() => {
  resetGridChecks()
  resetCueSession()
})

const BPM = 145
const DURATION_MS = 300000
const ON_KICKS: GridFit = { bpm: BPM, firstMs: 0 }

const ENTRIES: [string, string][] = [
  ['t1', '101'],
  ['t2', '102'],
  ['t3', '103'],
]

const readOn = (contentId: string, anchorMs: number): TrackCues => ({
  contentId,
  analysed: true,
  grid: gridBeats({ bpm: BPM, anchorMs }, DURATION_MS),
  strong: [],
  phrases: [],
  cues: [],
  wave: null,
  durationMs: DURATION_MS,
  fingerprint: 'f0',
  gridFingerprint: 'g0',
})

const ANCHORS: Record<string, number> = { '101': 7, '102': 102, '103': 15 }

function setup(
  trackCues = vi.fn<Api['cues']['trackCues']>(async (id) => readOn(id, ANCHORS[id])),
  queued = vi.fn<Api['cues']['queued']>(async () => null),
) {
  const gridFit = vi.fn<Api['cues']['gridFit']>(async () => ON_KICKS)
  installApi({ cues: { trackCues, gridFit, queued } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
  return { trackCues, gridFit, client, wrapper }
}

const pending = () => {
  const release: (() => void)[] = []
  const trackCues = vi.fn<Api['cues']['trackCues']>(
    () =>
      new Promise((resolve) => {
        release.push(() => resolve(null))
      }),
  )
  return { trackCues, release }
}

const needsFix = (check: ReturnType<ReturnType<typeof useGridChecks>['checkOf']>, ms = 10) =>
  check ? needsGridFix(check, ms) : check

describe('useGridChecks', () => {
  it('measures nothing until the filter asks, since each track means decoding its audio', () => {
    const { trackCues, gridFit, wrapper } = setup()
    const { result } = renderHook(() => useGridChecks(ENTRIES, false), { wrapper })
    expect(trackCues).not.toHaveBeenCalled()
    expect(gridFit).not.toHaveBeenCalled()
    expect(result.current.done).toBe(0)
    expect(result.current.total).toBe(3)
  })

  it('measures every row of the list once asked, counting how far it got', async () => {
    const { gridFit, wrapper } = setup()
    const { result } = renderHook(() => useGridChecks(ENTRIES, true), { wrapper })
    await waitFor(() => expect(result.current.done).toBe(3))
    expect(gridFit).toHaveBeenCalledTimes(3)
    expect(needsFix(result.current.checkOf('t2'))).toBe(true)
    expect(needsFix(result.current.checkOf('t1'))).toBe(false)
    expect(result.current.checkOfContent('102')).toEqual(result.current.checkOf('t2'))
  })

  it('keeps no wave from the tracks it measures, since judging a grid needs only its beats and a big list would hold thousands of them', async () => {
    const wave = Array.from({ length: 1200 }, () => ({ h: 0.5, rgb: null }))
    const { client, wrapper } = setup(
      vi.fn<Api['cues']['trackCues']>(async (id) => ({ ...readOn(id, ANCHORS[id]), wave })),
    )
    const { result } = renderHook(() => useGridChecks(ENTRIES, true), { wrapper })
    await waitFor(() => expect(result.current.done).toBe(3))
    const kept = client
      .getQueryCache()
      .getAll()
      .filter((q) => (q.state.data as TrackCues | null | undefined)?.wave)
    expect(kept).toEqual([])
    expect(needsFix(result.current.checkOf('t2'))).toBe(true)
    expect(needsFix(result.current.checkOf('t1'))).toBe(false)
  })

  it('walks a big list once while measuring it, so checking thousands of tracks stays linear', async () => {
    const { wrapper } = setup(vi.fn<Api['cues']['trackCues']>(async () => null))
    const size = 200
    let reads = 0
    const list: [string, string][] = Array.from({ length: size }, (_, i) => [`t${i}`, `${i}`])
    const counted = new Proxy(list, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1
        return Reflect.get(target, key, receiver)
      },
    })
    const { result } = renderHook(() => useGridChecks(counted, true), { wrapper })
    await waitFor(() => expect(result.current.done).toBe(size))
    expect(reads).toBeLessThan(size * 20)
  })

  it('keeps what it measured for the session, so turning the filter on again is instant', async () => {
    const { gridFit, wrapper } = setup()
    const first = renderHook(() => useGridChecks(ENTRIES, true), { wrapper })
    await waitFor(() => expect(first.result.current.done).toBe(3))
    first.unmount()
    const again = renderHook(() => useGridChecks(ENTRIES, true), { wrapper })
    expect(again.result.current.done).toBe(3)
    expect(gridFit).toHaveBeenCalledTimes(3)
  })

  it('stops measuring when the filter is turned off', async () => {
    const { trackCues, release } = pending()
    const { wrapper } = setup(trackCues)
    const { rerender } = renderHook(({ on }) => useGridChecks(ENTRIES, on), {
      wrapper,
      initialProps: { on: true },
    })
    await waitFor(() => expect(trackCues).toHaveBeenCalled())
    const asked = trackCues.mock.calls.length
    rerender({ on: false })
    await act(async () => {
      for (const r of release) r()
    })
    expect(trackCues).toHaveBeenCalledTimes(asked)
  })

  it('keeps measuring while the list is re-read around it, as rows arrive, without losing or repeating a track', async () => {
    const { trackCues, release } = pending()
    const { wrapper } = setup(trackCues)
    const { result, rerender } = renderHook(({ list }) => useGridChecks(list, true), {
      wrapper,
      initialProps: { list: ENTRIES.map((e) => [...e] as [string, string]) },
    })
    await waitFor(() => expect(trackCues).toHaveBeenCalledTimes(2))
    rerender({ list: ENTRIES.map((e) => [...e] as [string, string]) })
    await act(async () => {
      for (const r of release.splice(0)) r()
    })
    await waitFor(() => expect(trackCues).toHaveBeenCalledTimes(3))
    await act(async () => {
      for (const r of release.splice(0)) r()
    })
    await waitFor(() => expect(result.current.done).toBe(3))
    expect(trackCues).toHaveBeenCalledTimes(3)
  })

  it('measures the unsaved draft so an adjusted track leaves the filter before saving', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useGridChecks(ENTRIES, true), { wrapper })
    await waitFor(() => expect(result.current.done).toBe(3))
    expect(needsFix(result.current.checkOf('t2'))).toBe(true)
    const read = readOn('102', 102)
    const programGrid = editableGridOf(read.grid) as EditableGrid
    const adjusted = startDraft([], 'f', [], { bpm: BPM, anchorMs: 0 }, 'g0', programGrid)
    act(() => {
      keepDraft('102', cueDraftKey('102', 'f0', null), adjusted, {
        path: '/m/102.mp3',
        label: '102',
        fingerprint: 'f0',
      })
    })
    expect(needsFix(result.current.checkOf('t2'))).toBe(false)
  })

  it('measures the grid a fresh queued save already holds, so a track adjusted while the program was open leaves the filter', async () => {
    const { wrapper } = setup(
      undefined,
      vi.fn<Api['cues']['queued']>(async (id) =>
        id === '102'
          ? { wanted: [], fingerprint: 'f0', grid: { bpm: BPM, anchorMs: 0 }, gridFingerprint: 'q' }
          : null,
      ),
    )
    const { result } = renderHook(() => useGridChecks(ENTRIES, true), { wrapper })
    await waitFor(() => expect(result.current.done).toBe(3))
    expect(needsFix(result.current.checkOf('t2'))).toBe(false)
  })

  it('ignores a draft kept for cues the library no longer holds, as the batch does', async () => {
    const { wrapper } = setup()
    const read = readOn('102', 102)
    const programGrid = editableGridOf(read.grid) as EditableGrid
    const adjusted = startDraft([], 'f', [], { bpm: BPM, anchorMs: 0 }, 'g0', programGrid)
    keepDraft('102', cueDraftKey('102', 'older', null), adjusted, {
      path: '/m/102.mp3',
      label: '102',
      fingerprint: 'older',
    })
    const { result } = renderHook(() => useGridChecks(ENTRIES, true), { wrapper })
    await waitFor(() => expect(result.current.done).toBe(3))
    expect(needsFix(result.current.checkOf('t2'))).toBe(true)
  })

  it('recounts when the grid of a draft already kept is fitted in the editor', async () => {
    const { wrapper } = setup()
    const read = readOn('102', 102)
    const programGrid = editableGridOf(read.grid) as EditableGrid
    const target = { path: '/m/102.mp3', label: '102', fingerprint: 'f0' }
    const draftKey = cueDraftKey('102', 'f0', null)
    const original = startDraft([], 'f', [], programGrid, 'g0', programGrid)
    keepDraft('102', draftKey, original, target)
    const { result } = renderHook(
      () => {
        const { checkOfContent, done } = useGridChecks(ENTRIES, true)
        const bad = useMemo(
          () => ENTRIES.filter(([, id]) => needsFix(checkOfContent(id))).length,
          [checkOfContent],
        )
        return { bad, done }
      },
      { wrapper },
    )
    await waitFor(() => expect(result.current.done).toBe(3))
    expect(result.current.bad).toBe(2)
    act(() => {
      keepDraft('102', draftKey, { ...original, grid: { bpm: BPM, anchorMs: 0 } }, target)
    })
    expect(result.current.bad).toBe(1)
  })

  it('measures behind whatever the DJ opens, asking for the fit at low priority', async () => {
    const { gridFit, wrapper } = setup()
    const { result } = renderHook(() => useGridChecks(ENTRIES, true), { wrapper })
    await waitFor(() => expect(result.current.done).toBe(3))
    expect(gridFit).toHaveBeenCalledWith('102', 'low')
  })

  it('recounts when tolerance changes without asking for the fit again', async () => {
    const { gridFit, wrapper } = setup()
    const { result } = renderHook(() => useGridChecks(ENTRIES, true), { wrapper })
    await waitFor(() => expect(result.current.done).toBe(3))
    const count = (ms: number) =>
      ENTRIES.filter(([id]) => needsFix(result.current.checkOf(id), ms)).length
    expect(count(10)).toBe(2)
    expect(count(20)).toBe(1)
    expect(count(5)).toBe(3)
    expect(gridFit).toHaveBeenCalledTimes(3)
  })

  it('drops a track from the count once its saved grid is the adjusted one', async () => {
    const reads: Record<string, TrackCues> = {
      '101': readOn('101', 0),
      '102': readOn('102', 102),
      '103': readOn('103', 0),
    }
    const { client, gridFit, wrapper } = setup(
      vi.fn<Api['cues']['trackCues']>(async (id) => reads[id]),
    )
    const { result } = renderHook(() => useGridChecks(ENTRIES, true), { wrapper })
    await waitFor(() => expect(result.current.done).toBe(3))
    expect(needsFix(result.current.checkOf('t2'))).toBe(true)
    reads['102'] = readOn('102', 0)
    await act(async () => {
      await client.invalidateQueries({ queryKey: trackCuesQuery('102').queryKey.slice(0, 1) })
    })
    await waitFor(() => expect(needsFix(result.current.checkOf('t2'))).toBe(false))
    expect(gridFit).toHaveBeenCalledTimes(3)
  })
})

// With every import analysed, the grid of each of 8,000 Traktor rows is measured, and each
// measure re-rendered the whole App and recounted every filter over the list: 130 renders a
// second, the list's read starved behind them. A burst of measures is told in batches.
describe('useGridChecks telling a burst of measures', () => {
  it('re-renders about once a second while measures keep landing, and ends with all of them', async () => {
    const entries = Array.from({ length: 30 }, (_, i): [string, string] => [`t${i}`, `${200 + i}`])
    const { wrapper } = setup(vi.fn<Api['cues']['trackCues']>(async (id) => readOn(id, 7)))
    let renders = 0
    const { result } = renderHook(
      () => {
        renders++
        return useGridChecks(entries, true)
      },
      { wrapper },
    )

    await waitFor(() => expect(result.current.done).toBe(30), { timeout: 3000 })

    expect(renders).toBeLessThanOrEqual(5)
  })
})
