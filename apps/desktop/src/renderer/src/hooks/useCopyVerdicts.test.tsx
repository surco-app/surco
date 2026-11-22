// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../lib/queryClient'
import { useCopyVerdicts } from './useCopyVerdicts'

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

function wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>
}

function spectrumFor(path: string) {
  return path.endsWith('.mp3')
    ? { image: '', cutoffHz: 16000, sampleRateHz: 44100, processed: false, hasKnee: false }
    : { image: '', cutoffHz: 22050, sampleRateHz: 44100, processed: false, hasKnee: false }
}

afterEach(() => vi.restoreAllMocks())

describe('useCopyVerdicts', () => {
  it('measures each copy against this file', async () => {
    setApi({
      spectrogram: vi.fn(async (path: string) => spectrumFor(path)),
      loudness: vi.fn().mockResolvedValue(loudness),
      fingerprint: vi.fn().mockResolvedValue('abc'),
      comparePair: vi.fn().mockResolvedValue({ gainDb: 0, lagMs: 0 }),
      properties: vi.fn().mockResolvedValue(null),
    })
    const { result } = renderHook(
      () => useCopyVerdicts('/here/a.wav', ['/lib/a.mp3', '/lib/b.wav']),
      { wrapper },
    )
    await waitFor(() => expect(result.current.every((row) => !row.measuring)).toBe(true))
    expect(result.current).toHaveLength(2)
    expect(result.current[0].verdict).not.toBeNull()
    expect(result.current[1].verdict).not.toBeNull()
    expect(result.current[0].here?.ext).toBe('WAV')
    expect(result.current[0].copy?.ext).toBe('MP3')
  })

  it('reports measuring until every fact is in', async () => {
    setApi({
      spectrogram: vi.fn(async (path: string) => spectrumFor(path)),
      loudness: vi.fn().mockResolvedValue(loudness),
      fingerprint: vi.fn().mockResolvedValue('abc'),
      comparePair: vi.fn(() => new Promise(() => {})),
      properties: vi.fn().mockResolvedValue(null),
    })
    const { result } = renderHook(() => useCopyVerdicts('/here/a.wav', ['/lib/a.mp3']), {
      wrapper,
    })
    expect(result.current[0].measuring).toBe(true)
    await waitFor(() => expect(result.current[0].here).toBeDefined())
    expect(result.current[0].measuring).toBe(true)
    expect(result.current[0].verdict).toBeNull()
  })

  it('starts nothing without copies', () => {
    const spectrogram = vi.fn()
    setApi({ spectrogram, loudness: vi.fn(), fingerprint: vi.fn() })
    const { result } = renderHook(() => useCopyVerdicts('/here/a.wav', []), { wrapper })
    expect(result.current).toEqual([])
    expect(spectrogram).not.toHaveBeenCalled()
  })
})
