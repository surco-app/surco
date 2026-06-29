// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SpectrumResult } from '../../../shared/types'
import { useSpectrogram } from './useSpectrogram'

const sample: SpectrumResult = {
  image: 'data:image/png;base64,',
  cutoffHz: 16000,
  sampleRateHz: 44100,
  processed: false,
}

function setApi(spectrogram: ReturnType<typeof vi.fn>): void {
  ;(window as unknown as { api: unknown }).api = { spectrogram }
}

function wrapper(): ({ children }: { children: React.ReactNode }) => React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(() => vi.restoreAllMocks())

describe('useSpectrogram', () => {
  // The analysis is a full ffmpeg pass, so the Quality panel must analyse the exact
  // track it shows and run that pass once.
  it('analyses the input path and returns the spectrum', async () => {
    const analyse = vi.fn().mockResolvedValue(sample)
    setApi(analyse)
    const { result } = renderHook(() => useSpectrogram('/music/a.wav', true), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.data).toEqual(sample))
    // The editor's selected track is the one the user waits on, so it decodes at 'high' to
    // jump ahead of a background sweep's 'low' floods in the analysis limiter.
    expect(analyse).toHaveBeenCalledWith('/music/a.wav', 'high')
  })

  // The Quality section is an opt-in Settings toggle; with it off the ffmpeg pass must
  // not run for the open track.
  it('does not analyse while disabled', () => {
    const analyse = vi.fn().mockResolvedValue(sample)
    setApi(analyse)
    const { result } = renderHook(() => useSpectrogram('/music/a.wav', false), {
      wrapper: wrapper(),
    })
    expect(analyse).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()
  })

  // A file ffmpeg cannot read surfaces as an error so the panel can show the failure
  // rather than spin forever.
  it('surfaces a failed analysis as an error', async () => {
    setApi(vi.fn().mockRejectedValue(new Error('cannot read')))
    const { result } = renderHook(() => useSpectrogram('/music/a.wav', true), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
