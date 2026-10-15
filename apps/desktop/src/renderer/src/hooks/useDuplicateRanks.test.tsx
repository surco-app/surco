// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../lib/queryClient'
import type { TrackItem } from '../types'
import { useDuplicateRanks } from './useDuplicateRanks'

function track(id: string, title: string): TrackItem {
  return {
    id,
    inputPath: `/m/${id}`,
    fileName: id,
    query: '',
    status: 'idle',
    listLabel: title,
    duration: 300,
    meta: { title, artist: 'Netzwerk' },
  } as TrackItem
}

const loudness = (peakCount: number, crestDb: number) => ({
  integratedLufs: -10,
  truePeakDb: -0.1,
  lra: 5,
  crestDb,
  peakCount,
  channelBalanceDb: null,
  dcOffset: null,
  noiseFloorDb: null,
})

function setApi(): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    spectrogram: vi.fn().mockResolvedValue({ image: 'png', cutoffHz: 22050, hasKnee: false }),
    loudness: vi.fn((path: string) =>
      Promise.resolve(path.endsWith('.wav') ? loudness(1978, 10) : loudness(1, 13)),
    ),
    fingerprint: vi.fn((path: string) => Promise.resolve(path)),
    comparePair: vi.fn().mockResolvedValue({ correlation: 0.995, residualDb: -20, gainDb: -2 }),
  }
  ;(window as unknown as { api: unknown }).api = api
  return api
}

function wrapper(): ({ children }: { children: React.ReactNode }) => React.JSX.Element {
  const client = createQueryClient()
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(() => vi.restoreAllMocks())

describe('useDuplicateRanks', () => {
  it('ranks the copies of one recording once every fact and the pair are in', async () => {
    setApi()
    const tracks = [track('a.wav', 'Passion'), track('b.aif', 'Passion')]
    const { result } = renderHook(() => useDuplicateRanks(tracks), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.size).toBe(2))
    expect(result.current.get('a.wav')).toMatchObject({ rank: 'worse', reason: 'peakCount' })
    expect(result.current.get('b.aif')).toMatchObject({ rank: 'best', reason: 'peakCount' })
  })

  // Probing a track with no duplicate would decode a whole list for an icon nobody sees.
  it('measures only tracks that have another copy in the list', async () => {
    const api = setApi()
    const tracks = [track('a.wav', 'Passion'), track('b.aif', 'Passion'), track('c.aif', 'Other')]
    const { result } = renderHook(() => useDuplicateRanks(tracks), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.size).toBe(2))
    expect(api.fingerprint).not.toHaveBeenCalledWith('/m/c.aif', 'low')
    expect(api.comparePair).toHaveBeenCalledTimes(1)
  })

  // A copy that could not be measured hides its whole group: ranking the rest would call
  // one of them best against a copy nobody looked at.
  it('ranks no member of a group whose copy failed to measure', async () => {
    const api = setApi()
    api.loudness.mockImplementation((path: string) =>
      path === '/m/a.wav' ? Promise.reject(new Error('ENOENT')) : Promise.resolve(loudness(1, 13)),
    )
    const tracks = [
      track('a.wav', 'Passion'),
      track('b.aif', 'Passion'),
      track('c.wav', 'Other'),
      track('d.aif', 'Other'),
    ]
    const { result } = renderHook(() => useDuplicateRanks(tracks), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.has('d.aif')).toBe(true))
    expect(result.current.has('a.wav')).toBe(false)
    expect(result.current.has('b.aif')).toBe(false)
  })

  it('ranks no member of a group while one copy is still being measured', async () => {
    const api = setApi()
    api.fingerprint.mockImplementation((path: string) =>
      path === '/m/a.wav' ? new Promise(() => {}) : Promise.resolve(path),
    )
    const tracks = [
      track('a.wav', 'Passion'),
      track('b.aif', 'Passion'),
      track('c.wav', 'Other'),
      track('d.aif', 'Other'),
    ]
    const { result } = renderHook(() => useDuplicateRanks(tracks), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.has('d.aif')).toBe(true))
    expect(result.current.has('a.wav')).toBe(false)
    expect(result.current.has('b.aif')).toBe(false)
  })

  // Every progress tick hands the list a new tracks array; the rows are memoized, so a
  // fresh rank object per tick would re-render every duplicate row for nothing.
  it('keeps the same rank objects while nothing about the copies changed', async () => {
    setApi()
    const { result, rerender } = renderHook(({ tracks }) => useDuplicateRanks(tracks), {
      wrapper: wrapper(),
      initialProps: { tracks: [track('a.wav', 'Passion'), track('b.aif', 'Passion')] },
    })
    await waitFor(() => expect(result.current.size).toBe(2))
    const before = result.current
    rerender({ tracks: [track('a.wav', 'Passion'), track('b.aif', 'Passion')] })
    expect(result.current).toBe(before)
    expect(result.current.get('b.aif')).toBe(before.get('b.aif'))
  })

  // A track joining the list regroups everything, yet the copies already ranked keep
  // their verdict and so must keep their objects.
  it('keeps the same rank objects when an unrelated track joins the list', async () => {
    setApi()
    const { result, rerender } = renderHook(({ tracks }) => useDuplicateRanks(tracks), {
      wrapper: wrapper(),
      initialProps: { tracks: [track('a.wav', 'Passion'), track('b.aif', 'Passion')] },
    })
    await waitFor(() => expect(result.current.size).toBe(2))
    const before = result.current
    rerender({
      tracks: [track('a.wav', 'Passion'), track('b.aif', 'Passion'), track('c.aif', 'Other')],
    })
    expect(result.current).toBe(before)
    expect(result.current.get('b.aif')).toBe(before.get('b.aif'))
  })
})
