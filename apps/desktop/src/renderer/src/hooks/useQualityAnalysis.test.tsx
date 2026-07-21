// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SpectrumResult } from '../../../shared/types'
import { createQueryClient } from '../lib/queryClient'
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
  const client = createQueryClient()
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function setApi(over: Record<string, unknown>): void {
  ;(window as unknown as { api: unknown }).api = {
    spectrogram: vi.fn().mockResolvedValue(spectrum),
    waveform: vi.fn().mockResolvedValue(null),
    waveformScan: vi.fn().mockResolvedValue(null),
    loudness: vi.fn().mockResolvedValue(null),
    clicks: vi.fn().mockResolvedValue(null),
    bpm: vi.fn().mockResolvedValue(null),
    key: vi.fn().mockResolvedValue(null),
    properties: vi.fn().mockResolvedValue(null),
    onWindowFocus: () => () => {},
    ...over,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('useQualityAnalysis', () => {
  // The sweep is the bulk "check the whole folder for fake-lossless rips" action: it must
  // measure every not-yet-analyzed track exactly once and leave already-measured ones
  // (those with a spectrum) alone, then return to idle.
  it('analyzes only the not-yet-measured tracks and ends idle', async () => {
    const spectrogram = vi.fn().mockResolvedValue(spectrum)
    setApi({ spectrogram })
    const targetsRef = {
      current: [
        track('a'),
        track('b', { spectrum }), // already measured — skipped
        track('c'),
      ],
    }
    const { result } = renderHook(() => useQualityAnalysis({ targetsRef }), {
      wrapper: wrapper(),
    })

    act(() => result.current.analyzeAllQuality())
    await waitFor(() => expect(result.current.analysis).toBeNull())

    const measured = spectrogram.mock.calls.map((c) => c[0]).sort()
    expect(measured).toEqual(['/music/a.wav', '/music/c.wav'])
  })

  // Clipping is the second attention-filter fact, and since the clip/channel scan
  // split into its own probe it no longer rides the peaks wave. The sweep must decode
  // that scan too, or one "analyze all" would fill the silence bucket collection-wide
  // but leave the clipping bucket empty for every track the user never opened.
  it('decodes the clip scan for each not-yet-measured track', async () => {
    const waveformScan = vi.fn().mockResolvedValue(null)
    setApi({ waveformScan })
    const targetsRef = { current: [track('a'), track('b', { spectrum }), track('c')] }
    const { result } = renderHook(() => useQualityAnalysis({ targetsRef }), {
      wrapper: wrapper(),
    })

    act(() => result.current.analyzeAllQuality())
    await waitFor(() => expect(result.current.analysis).toBeNull())

    const scanned = waveformScan.mock.calls.map((c) => c[0]).sort()
    expect(scanned).toEqual(['/music/a.wav', '/music/c.wav'])
  })

  // A second trigger while a sweep is already running must not start a competing pass.
  it('ignores a re-trigger while a sweep is in flight', async () => {
    let release: (v: SpectrumResult) => void = () => {}
    const gate = new Promise<SpectrumResult>((r) => {
      release = r
    })
    const spectrogram = vi.fn().mockReturnValue(gate)
    setApi({ spectrogram })
    const targetsRef = { current: [track('a')] }
    const { result } = renderHook(() => useQualityAnalysis({ targetsRef }), {
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

  // A file ffmpeg can't read is swallowed so it doesn't abort the sweep, but the user must
  // still learn it went unmeasured rather than have it pass as a silently-skipped track that
  // looks the same as one never measured. The run reports how many files failed, once at the
  // end — never per file, which would bury the list under toasts on a bad folder.
  it('reports how many files failed to analyze, once when the sweep ends', async () => {
    const spectrogram = vi.fn(async (path: string) => {
      if (path === '/music/b.wav') throw new Error('unreadable')
      return spectrum
    })
    setApi({ spectrogram })
    const targetsRef = { current: [track('a'), track('b'), track('c')] }
    const onErrors = vi.fn()
    const { result } = renderHook(() => useQualityAnalysis({ targetsRef, onErrors }), {
      wrapper: wrapper(),
    })

    act(() => result.current.analyzeAllQuality())
    await waitFor(() => expect(result.current.analysis).toBeNull())

    expect(onErrors).toHaveBeenCalledTimes(1)
    expect(onErrors).toHaveBeenCalledWith(1)
  })

  // A clean sweep (every file measured) leaves the user undisturbed — the error report fires
  // only when something actually failed, so a good folder shows no "0 failed" noise.
  it('does not report errors when every file analyzes cleanly', async () => {
    const spectrogram = vi.fn().mockResolvedValue(spectrum)
    setApi({ spectrogram })
    const targetsRef = { current: [track('a'), track('b')] }
    const onErrors = vi.fn()
    const { result } = renderHook(() => useQualityAnalysis({ targetsRef, onErrors }), {
      wrapper: wrapper(),
    })

    act(() => result.current.analyzeAllQuality())
    await waitFor(() => expect(result.current.analysis).toBeNull())

    expect(onErrors).not.toHaveBeenCalled()
  })

  it('runs the full analysis set for each not-yet-measured track', async () => {
    const loudness = vi.fn().mockResolvedValue(null)
    const clicks = vi.fn().mockResolvedValue(null)
    const bpm = vi.fn().mockResolvedValue(null)
    const key = vi.fn().mockResolvedValue(null)
    const properties = vi.fn().mockResolvedValue(null)
    setApi({ loudness, clicks, bpm, key, properties })
    const targetsRef = { current: [track('a'), track('b', { spectrum }), track('c')] }
    const { result } = renderHook(() => useQualityAnalysis({ targetsRef }), { wrapper: wrapper() })

    act(() => result.current.analyzeAllQuality())
    await waitFor(() => expect(result.current.analysis).toBeNull())

    for (const probe of [loudness, clicks, bpm, key, properties]) {
      const paths = probe.mock.calls.map((c) => c[0]).sort()
      expect(paths).toEqual(['/music/a.wav', '/music/c.wav'])
    }
  })

  it('picks up tracks appended to targets while a sweep is running', async () => {
    let release: (v: SpectrumResult) => void = () => {}
    const gate = new Promise<SpectrumResult>((r) => {
      release = r
    })
    let first = true
    const spectrogram = vi.fn((): Promise<SpectrumResult> => {
      if (first) {
        first = false
        return gate
      }
      return Promise.resolve(spectrum)
    })
    setApi({ spectrogram })
    const targetsRef = { current: [track('a')] }
    const { result } = renderHook(() => useQualityAnalysis({ targetsRef }), { wrapper: wrapper() })

    act(() => result.current.analyzeAllQuality())
    // A new import lands while 'a' is still decoding.
    targetsRef.current = [track('a', { spectrum }), track('b')]
    await act(async () => {
      release(spectrum)
      await gate
    })
    await waitFor(() => expect(result.current.analysis).toBeNull())

    const measured = spectrogram.mock.calls.map((c) => c[0]).sort()
    expect(measured).toEqual(['/music/a.wav', '/music/b.wav'])
  })

  // cancelAnalysis must leave no trace of the run it stopped: an import queued via
  // pendingRef (Task 3's explicit-candidates path) but not yet swept must not resurrect
  // itself the next time analyzeAllQuality runs, the same way cancelAutoMatch clears its
  // own queue on cancel.
  it('drops a queued-but-unswept import when the sweep is cancelled', async () => {
    let release: (v: SpectrumResult) => void = () => {}
    const gate = new Promise<SpectrumResult>((r) => {
      release = r
    })
    const spectrogram = vi.fn((path: string): Promise<SpectrumResult> => {
      if (path === '/music/a.wav') return gate
      return Promise.resolve(spectrum)
    })
    setApi({ spectrogram })
    const targetsRef = { current: [track('a')] }
    const { result } = renderHook(() => useQualityAnalysis({ targetsRef }), { wrapper: wrapper() })

    act(() => result.current.analyzeAllQuality())
    // An import lands mid-sweep, queued via pendingRef since targetsRef hasn't caught up yet.
    act(() => result.current.analyzeAllQuality([track('z')]))
    act(() => result.current.cancelAnalysis())
    await act(async () => {
      release(spectrum)
      await gate
    })
    await waitFor(() => expect(result.current.analysis).toBeNull())

    spectrogram.mockClear()
    targetsRef.current = []
    act(() => result.current.analyzeAllQuality())
    await waitFor(() => expect(result.current.analysis).toBeNull())

    expect(spectrogram).not.toHaveBeenCalledWith('/music/z.wav')
  })

  // The Task-3 mechanism: an import's onMetaLoaded can call analyzeAllQuality with an
  // explicit track before targetsRef's render has caught up with it. That track must
  // survive the runningRef guard (via pendingRef) and be drained by the finally's relaunch
  // once the in-flight sweep finishes, not be dropped on the floor.
  it('drains a track handed to analyzeAllQuality explicitly while a sweep is running', async () => {
    let release: (v: SpectrumResult) => void = () => {}
    const gate = new Promise<SpectrumResult>((r) => {
      release = r
    })
    const spectrogram = vi.fn((path: string): Promise<SpectrumResult> => {
      if (path === '/music/a.wav') return gate
      return Promise.resolve(spectrum)
    })
    setApi({ spectrogram })
    const targetsRef = { current: [track('a')] }
    const { result } = renderHook(() => useQualityAnalysis({ targetsRef }), { wrapper: wrapper() })

    act(() => result.current.analyzeAllQuality())
    // 'b' isn't in targetsRef yet — mirrors onMetaLoaded firing ahead of the render.
    act(() => result.current.analyzeAllQuality([track('b')]))
    await act(async () => {
      release(spectrum)
      await gate
    })
    await waitFor(() => expect(result.current.analysis).toBeNull())

    const measured = spectrogram.mock.calls.map((c) => c[0]).sort()
    expect(measured).toEqual(['/music/a.wav', '/music/b.wav'])
  })
})
