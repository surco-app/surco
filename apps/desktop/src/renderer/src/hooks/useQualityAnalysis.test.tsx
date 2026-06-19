// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SpectrumResult } from '../../../shared/types'
import type { TrackItem } from '../types'
import { useQualityAnalysis } from './useQualityAnalysis'

const spectrum = { cutoffKHz: 20 } as unknown as SpectrumResult

function track(id: string, over: Partial<TrackItem> = {}): TrackItem {
  return {
    id,
    inputPath: `/music/${id}.wav`,
    fileName: `${id}.wav`,
    query: '',
    status: 'idle',
    listLabel: id,
    meta: {} as TrackItem['meta'],
    ...over,
  }
}

function wrapper(): ({ children }: { children: React.ReactNode }) => React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(() => vi.restoreAllMocks())

describe('useQualityAnalysis', () => {
  // The sweep is the bulk "check the whole folder for fake-lossless rips" action: it must
  // measure every not-yet-analyzed track exactly once and leave already-measured ones
  // (those with a spectrum) alone, then return to idle.
  it('analyzes only the not-yet-measured tracks and ends idle', async () => {
    const spectrogram = vi.fn().mockResolvedValue(spectrum)
    ;(window as unknown as { api: unknown }).api = { spectrogram, onWindowFocus: () => () => {} }
    const tracksViewRef = {
      current: [
        track('a'),
        track('b', { spectrum }), // already measured — skipped
        track('c'),
      ],
    }
    const { result } = renderHook(() => useQualityAnalysis({ tracksViewRef }), {
      wrapper: wrapper(),
    })

    act(() => result.current.analyzeAllQuality())
    await waitFor(() => expect(result.current.analysis).toBeNull())

    const measured = spectrogram.mock.calls.map((c) => c[0]).sort()
    expect(measured).toEqual(['/music/a.wav', '/music/c.wav'])
  })

  // A second trigger while a sweep is already running must not start a competing pass.
  it('ignores a re-trigger while a sweep is in flight', async () => {
    let release: (v: SpectrumResult) => void = () => {}
    const gate = new Promise<SpectrumResult>((r) => {
      release = r
    })
    const spectrogram = vi.fn().mockReturnValue(gate)
    ;(window as unknown as { api: unknown }).api = { spectrogram, onWindowFocus: () => () => {} }
    const tracksViewRef = { current: [track('a')] }
    const { result } = renderHook(() => useQualityAnalysis({ tracksViewRef }), {
      wrapper: wrapper(),
    })

    act(() => result.current.analyzeAllQuality())
    act(() => result.current.analyzeAllQuality()) // re-trigger mid-sweep

    await act(async () => {
      release(spectrum)
      await gate
    })
    await waitFor(() => expect(result.current.analysis).toBeNull())

    expect(spectrogram).toHaveBeenCalledTimes(1)
  })
})
