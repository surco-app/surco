// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SpectrumResult } from '../../../shared/types'
import { createQueryClient } from '../lib/queryClient'
import { useSpectrogram } from './useSpectrogram'

const sample: SpectrumResult = {
  image: 'data:image/png;base64,',
  cutoffHz: 16000,
  sampleRateHz: 44100,
  processed: false,
}

function setApi(
  spectrogram: ReturnType<typeof vi.fn>,
  cancelAnalysis: ReturnType<typeof vi.fn> = vi.fn(),
): void {
  ;(window as unknown as { api: unknown }).api = { spectrogram, cancelAnalysis }
}

function wrapper(): ({ children }: { children: React.ReactNode }) => React.JSX.Element {
  const client = createQueryClient()
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

  // Browsing quickly leaves each abandoned track's ffmpeg trio decoding to completion,
  // holding the limiter slots the newly selected track then queues behind. Unmounting
  // mid-analysis (the editor remounts per track) must tell main to kill that work.
  it('cancels the analysis in main when unmounted mid-flight', async () => {
    const analyse = vi.fn().mockReturnValue(new Promise(() => {}))
    const cancel = vi.fn().mockResolvedValue(undefined)
    setApi(analyse, cancel)
    const { unmount } = renderHook(() => useSpectrogram('/music/a.wav', true), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(analyse).toHaveBeenCalled())
    unmount()
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('/music/a.wav'))
  })
})
