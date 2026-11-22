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

const properties = {
  codec: 'mp3',
  container: 'mp3',
  sampleRateHz: 44100,
  bitDepth: null,
  channels: 2,
  bitrateKbps: 320,
  sizeBytes: 1,
  createdMs: null,
  modifiedMs: null,
}

const cutoffs: Record<string, number> = {
  '/here/a.mp3': 16000,
  '/lib/better.wav': 22050,
  '/lib/worse.mp3': 12000,
}

function setApi(api: Record<string, unknown>): void {
  ;(window as unknown as { api: unknown }).api = api
}

function wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>
}

function spectrumFor(path: string) {
  return {
    image: '',
    cutoffHz: cutoffs[path],
    sampleRateHz: 44100,
    processed: false,
    hasKnee: false,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('useCopyVerdicts', () => {
  it('measures each copy against this file', async () => {
    setApi({
      spectrogram: vi.fn(async (path: string) => spectrumFor(path)),
      loudness: vi.fn().mockResolvedValue(loudness),
      fingerprint: vi.fn(async (path: string) => `fp${path}`),
      comparePair: vi.fn().mockResolvedValue({ correlation: 0.9, residualDb: -10, gainDb: 0 }),
      properties: vi.fn(async (path: string) => (path === '/lib/worse.mp3' ? properties : null)),
    })
    const { result } = renderHook(
      () => useCopyVerdicts('/here/a.mp3', ['/lib/better.wav', '/lib/worse.mp3']),
      { wrapper },
    )
    await waitFor(() => expect(result.current.every((row) => !row.measuring)).toBe(true))
    expect(result.current.map((row) => row.verdict?.winner)).toEqual(['b', 'a'])
    expect(result.current.map((row) => row.copy?.ext)).toEqual(['WAV', 'MP3'])
    expect(result.current[0].here?.ext).toBe('MP3')
    expect(result.current.map((row) => row.format)).toEqual(['', 'MP3 320'])
  })

  it('reports measuring until every fact is in', async () => {
    setApi({
      spectrogram: vi.fn(async (path: string) => spectrumFor(path)),
      loudness: vi.fn().mockResolvedValue(loudness),
      fingerprint: vi.fn().mockResolvedValue('abc'),
      comparePair: vi.fn(() => new Promise(() => {})),
      properties: vi.fn().mockResolvedValue(null),
    })
    const { result } = renderHook(() => useCopyVerdicts('/here/a.mp3', ['/lib/worse.mp3']), {
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
    const { result } = renderHook(() => useCopyVerdicts('/here/a.mp3', []), { wrapper })
    expect(result.current).toEqual([])
    expect(spectrogram).not.toHaveBeenCalled()
  })
})
