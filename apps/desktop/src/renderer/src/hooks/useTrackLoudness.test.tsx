// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LoudnessResult } from '../../../shared/types'
import { createQueryClient } from '../lib/queryClient'
import { useTrackLoudness } from './useTrackLoudness'

const sample: LoudnessResult = {
  integratedLufs: -9,
  truePeakDb: -0.2,
  lra: 4,
  crestDb: 10,
  channelBalanceDb: 0.1,
  dcOffset: 0.001,
  noiseFloorDb: -80,
}

function setApi(loudness: ReturnType<typeof vi.fn>): void {
  ;(window as unknown as { api: unknown }).api = { loudness }
}

function wrapper(): ({ children }: { children: React.ReactNode }) => React.JSX.Element {
  const client = createQueryClient()
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(() => vi.restoreAllMocks())

describe('useTrackLoudness', () => {
  // Each measure is a full ffmpeg pass, so the readout must measure the exact track it
  // shows and run that pass once.
  it('measures the input path and returns the loudness', async () => {
    const measure = vi.fn().mockResolvedValue(sample)
    setApi(measure)
    const { result } = renderHook(() => useTrackLoudness('/music/a.wav', true), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.data).toEqual(sample))
    expect(measure).toHaveBeenCalledWith('/music/a.wav')
  })

  // The readout is an opt-in Settings toggle; with it off there is nothing to show, so
  // the expensive ffmpeg pass must not run.
  it('does not measure while disabled', () => {
    const measure = vi.fn().mockResolvedValue(sample)
    setApi(measure)
    const { result } = renderHook(() => useTrackLoudness('/music/a.wav', false), {
      wrapper: wrapper(),
    })
    expect(measure).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()
  })

  // A file the measure could not read resolves to null; the readout treats that as
  // "nothing to show" rather than an error state.
  it('returns null when the measurement is unavailable', async () => {
    setApi(vi.fn().mockResolvedValue(null))
    const { result } = renderHook(() => useTrackLoudness('/music/a.wav', true), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.data).toBeNull())
  })
})
