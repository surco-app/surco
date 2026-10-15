// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../lib/queryClient'
import { useCopyFacts, usePairFacts } from './useCopyFacts'

const loudness = {
  integratedLufs: -12.2,
  truePeakDb: -0.7,
  lra: 5.4,
  crestDb: 13.2,
  peakCount: 1,
  channelBalanceDb: null,
  dcOffset: null,
  noiseFloorDb: null,
}

function setApi(api: Record<string, unknown>): void {
  ;(window as unknown as { api: unknown }).api = api
}

function wrapper(): ({ children }: { children: React.ReactNode }) => React.JSX.Element {
  const client = createQueryClient()
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(() => vi.restoreAllMocks())

describe('useCopyFacts', () => {
  it('gathers spectrum, loudness and fingerprint into one set of facts', async () => {
    setApi({
      spectrogram: vi.fn().mockResolvedValue({
        image: '',
        cutoffHz: 22050,
        sampleRateHz: 44100,
        processed: false,
        hasKnee: false,
      }),
      loudness: vi.fn().mockResolvedValue(loudness),
      fingerprint: vi.fn().mockResolvedValue('abc'),
    })
    const { result } = renderHook(() => useCopyFacts('/m/a.aif', true), { wrapper: wrapper() })
    await waitFor(() => expect(result.current).not.toBeUndefined())
    expect(result.current).toEqual({
      ext: 'AIF',
      cutoffHz: 22050,
      hasKnee: false,
      processed: false,
      upsampled: undefined,
      fingerprint: 'abc',
      peakCount: 1,
      crestDb: 13.2,
      integratedLufs: -12.2,
    })
  })

  // A copy whose file vanished must not keep a verdict alive.
  it('has no facts for a file the probes could not read', async () => {
    const fingerprint = vi.fn().mockResolvedValue(null)
    setApi({
      spectrogram: vi.fn().mockRejectedValue(new Error('ENOENT')),
      loudness: vi.fn().mockResolvedValue(null),
      fingerprint,
    })
    const { result } = renderHook(() => useCopyFacts('/gone.wav', true), { wrapper: wrapper() })
    await waitFor(() => expect(result.current).toBeNull())
  })

  it('is still measuring while a probe is pending', () => {
    setApi({
      spectrogram: vi.fn().mockResolvedValue({ image: '', cutoffHz: 22050 }),
      loudness: vi.fn().mockResolvedValue(loudness),
      fingerprint: vi.fn(() => new Promise<string | null>(() => {})),
    })
    const { result } = renderHook(() => useCopyFacts('/m/a.aif', true), { wrapper: wrapper() })
    expect(result.current).toBeUndefined()
  })

  it('probes nothing and has no facts while disabled or without a path', () => {
    const fingerprint = vi.fn()
    setApi({ spectrogram: vi.fn(), loudness: vi.fn(), fingerprint })
    const off = renderHook(() => useCopyFacts('/m/a.aif', false), { wrapper: wrapper() })
    const empty = renderHook(() => useCopyFacts('', true), { wrapper: wrapper() })
    expect(off.result.current).toBeUndefined()
    expect(empty.result.current).toBeUndefined()
    expect(fingerprint).not.toHaveBeenCalled()
  })
})

describe('usePairFacts', () => {
  it('compares a pair once whichever order the two paths come in', async () => {
    const comparePair = vi
      .fn()
      .mockResolvedValue({ correlation: 0.99, residualDb: -20, gainDb: -2 })
    setApi({ comparePair })
    const { result } = renderHook(
      () => [usePairFacts('/a', '/b', true), usePairFacts('/b', '/a', true)],
      { wrapper: wrapper() },
    )
    await waitFor(() =>
      expect(result.current[1]).toEqual({ correlation: 0.99, residualDb: -20, gainDb: -2 }),
    )
    expect(comparePair).toHaveBeenCalledTimes(1)
    expect(comparePair).toHaveBeenCalledWith('/a', '/b')
  })

  it('does not compare while disabled or when a path is empty', () => {
    const comparePair = vi.fn()
    setApi({ comparePair })
    const off = renderHook(() => usePairFacts('/a', '/b', false), { wrapper: wrapper() })
    const empty = renderHook(() => usePairFacts('/a', '', true), { wrapper: wrapper() })
    expect(off.result.current).toBeUndefined()
    expect(empty.result.current).toBeUndefined()
    expect(comparePair).not.toHaveBeenCalled()
  })
})
