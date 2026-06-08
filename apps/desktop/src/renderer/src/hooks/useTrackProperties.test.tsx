// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TrackProperties } from '../../../shared/types'
import { useTrackProperties } from './useTrackProperties'

const sample: TrackProperties = {
  codec: 'pcm_s16le',
  container: 'wav',
  sampleRateHz: 44100,
  bitDepth: 16,
  channels: 2,
  bitrateKbps: 1411,
  sizeBytes: 58_400_000,
  createdMs: 1_700_000_000_000,
  modifiedMs: 1_700_000_500_000,
  tagFormats: ['ID3v2.3', 'INFO'],
}

function setApi(properties: ReturnType<typeof vi.fn>): void {
  ;(window as unknown as { api: unknown }).api = { properties }
}

function wrapper(): ({ children }: { children: React.ReactNode }) => React.JSX.Element {
  // retry:false so a rejected probe settles into isError immediately instead of
  // backing off across the test's waitFor window.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(() => vi.restoreAllMocks())

describe('useTrackProperties', () => {
  // The probe is one ffprobe spawn per file, so the panel must read the facts for the
  // exact track it is showing and run the probe for it once.
  it('probes the input path and returns the properties', async () => {
    const probe = vi.fn().mockResolvedValue(sample)
    setApi(probe)
    const { result } = renderHook(() => useTrackProperties('/music/a.wav', true), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.data).toEqual(sample))
    expect(probe).toHaveBeenCalledWith('/music/a.wav')
  })

  // In multi-select there is no single source to inspect, so the panel is hidden and
  // the probe must not fire — spawning ffprobe for a track the user can't see is waste.
  it('does not probe while disabled', () => {
    const probe = vi.fn().mockResolvedValue(sample)
    setApi(probe)
    const { result } = renderHook(() => useTrackProperties('/music/a.wav', false), {
      wrapper: wrapper(),
    })
    expect(probe).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()
  })

  // A file ffprobe cannot read surfaces as an error so the panel can say "unavailable"
  // rather than spin forever waiting on data that will never arrive.
  it('surfaces a failed probe as an error', async () => {
    setApi(vi.fn().mockRejectedValue(new Error('cannot read')))
    const { result } = renderHook(() => useTrackProperties('/music/a.wav', true), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
