// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WaveformResult } from '../../../shared/types'
import { createQueryClient } from '../lib/queryClient'
import { useWaveform } from './useWaveform'

const sample: WaveformResult = { peaks: [0.1, 0.9, 0.4], durationSec: 212 }

function setApi(waveform: ReturnType<typeof vi.fn>): void {
  ;(window as unknown as { api: unknown }).api = { waveform }
}

function wrapper(): ({ children }: { children: React.ReactNode }) => React.JSX.Element {
  const client = createQueryClient()
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(() => vi.restoreAllMocks())

describe('useWaveform', () => {
  // The player's strip is the one decode a DJ is actively waiting on (they just hit play),
  // so it must decode the exact track it shows and jump ahead of any background sweep.
  it('decodes the input path at high priority and returns the peaks', async () => {
    const decode = vi.fn().mockResolvedValue(sample)
    setApi(decode)
    const { result } = renderHook(() => useWaveform('/music/a.wav', true), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.data).toEqual(sample))
    // 'high': opening the player (or the editor's wave sections) is explicit intent, so it
    // preempts the 'low' waveform decodes an "analyze all" sweep floods the limiter with.
    expect(decode).toHaveBeenCalledWith('/music/a.wav', 'high')
  })

  // The full-length decode is the heaviest probe, so a track with no duration yet (or a
  // folded wave section) must not trigger it.
  it('does not decode while disabled', () => {
    const decode = vi.fn().mockResolvedValue(sample)
    setApi(decode)
    const { result } = renderHook(() => useWaveform('/music/a.wav', false), { wrapper: wrapper() })
    expect(decode).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()
  })
})
