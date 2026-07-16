// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BpmResult } from '../../../shared/types'
import { createQueryClient } from '../lib/queryClient'
import { useBpm } from './useBpm'

const sample: BpmResult = { bpm: 124.02, confidence: 0.8 }

function setApi(bpm: ReturnType<typeof vi.fn>): void {
  ;(window as unknown as { api: unknown }).api = { bpm }
}

function wrapper(): ({ children }: { children: React.ReactNode }) => React.JSX.Element {
  const client = createQueryClient()
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(() => vi.restoreAllMocks())

describe('useBpm', () => {
  // Each detection decodes minutes of audio, so the suggestion must analyse the
  // exact track it is shown beside and run that decode once.
  it('detects the input path and returns the tempo', async () => {
    const detect = vi.fn().mockResolvedValue(sample)
    setApi(detect)
    const { result } = renderHook(() => useBpm('/music/a.wav', true), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.data).toEqual(sample))
    // The editor mounts this only for the selected track, the one the user is waiting on,
    // so it decodes at 'high' to jump ahead of a background sweep's 'low' floods.
    expect(detect).toHaveBeenCalledWith('/music/a.wav', 'high')
  })

  // The bpm field can be hidden in Settings (and is in multi-select); with no
  // field to suggest into, the expensive decode must not run.
  it('does not detect while disabled', () => {
    const detect = vi.fn().mockResolvedValue(sample)
    setApi(detect)
    const { result } = renderHook(() => useBpm('/music/a.wav', false), { wrapper: wrapper() })
    expect(detect).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()
  })

  // Beatless material legitimately measures null; the chip simply doesn't render
  // rather than suggesting a made-up tempo.
  it('returns null when no tempo was found', async () => {
    setApi(vi.fn().mockResolvedValue(null))
    const { result } = renderHook(() => useBpm('/music/a.wav', true), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.data).toBeNull())
  })
})
