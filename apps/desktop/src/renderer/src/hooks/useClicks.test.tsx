// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../lib/queryClient'
import { useClicks } from './useClicks'

const sample = { count: 3, marks: [1.2, 4.5, 9.0], scannedSec: 180 }

function setApi(clicks: ReturnType<typeof vi.fn>): void {
  ;(window as unknown as { api: unknown }).api = { clicks }
}

function wrapper(): ({ children }: { children: React.ReactNode }) => React.JSX.Element {
  const client = createQueryClient()
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(() => vi.restoreAllMocks())

describe('useClicks', () => {
  // The detector reads the whole side, so the repair section must scan the exact track it
  // shows and, being mounted only for the open track, jump ahead of a background sweep.
  it('detects the input path at high priority and returns the clicks', async () => {
    const detect = vi.fn().mockResolvedValue(sample)
    setApi(detect)
    const { result } = renderHook(() => useClicks('/music/a.wav', true), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.data).toEqual(sample))
    // 'high': the repair section is open only for the selected track the user is waiting on,
    // so its scan preempts a background sweep's 'low' floods in the analysis limiter.
    expect(detect).toHaveBeenCalledWith('/music/a.wav', 'high')
  })

  // The scan is a full read, so a folded repair section (enabled=false) must not run it.
  it('does not detect while disabled', () => {
    const detect = vi.fn().mockResolvedValue(sample)
    setApi(detect)
    const { result } = renderHook(() => useClicks('/music/a.wav', false), { wrapper: wrapper() })
    expect(detect).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()
  })
})
