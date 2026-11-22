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
  '/lib/edit.mp3': 16000,
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
      readDuration: vi.fn(async (path: string) => (path === '/lib/better.wav' ? 447.9 : 483.2)),
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
    expect(result.current.map((row) => row.copy?.durationSec)).toEqual([447.9, 483.2])
  })

  // Another version is named with its length; a verdict landing before the length would
  // change the pill's words under the reader a moment later.
  it('keeps measuring until the copy length is in', async () => {
    setApi({
      spectrogram: vi.fn(async (path: string) => spectrumFor(path)),
      loudness: vi.fn().mockResolvedValue(loudness),
      fingerprint: vi.fn(async (path: string) => `fp${path}`),
      comparePair: vi.fn().mockResolvedValue(null),
      properties: vi.fn().mockResolvedValue(null),
      readDuration: vi.fn(() => new Promise(() => {})),
    })
    const { result } = renderHook(() => useCopyVerdicts('/here/a.mp3', ['/lib/better.wav']), {
      wrapper,
    })
    await waitFor(() => expect(window.api.comparePair).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 50))
    expect(result.current[0].measuring).toBe(true)
    expect(result.current[0].verdict).toBeNull()
  })

  // The length is what tells another version from a drifting copy of one master, so both
  // lengths reach the comparison.
  it('calls a copy of another length the wider search found no match for another version', async () => {
    setApi({
      spectrogram: vi.fn(async (path: string) => spectrumFor(path)),
      loudness: vi.fn().mockResolvedValue(loudness),
      fingerprint: vi.fn(async (path: string) => `fp${path}`),
      comparePair: vi.fn().mockResolvedValue({ versionCorrelation: 0.1 }),
      properties: vi.fn().mockResolvedValue(null),
      readDuration: vi.fn(async (path: string) => (path === '/here/a.mp3' ? 483.2 : 447.9)),
    })
    const { result } = renderHook(() => useCopyVerdicts('/here/a.mp3', ['/lib/edit.mp3']), {
      wrapper,
    })
    await waitFor(() => expect(result.current[0].measuring).toBe(false))
    expect(result.current[0].verdict).toEqual({ winner: 'different' })
    expect(window.api.comparePair).toHaveBeenCalledWith('/here/a.mp3', '/lib/edit.mp3', true)
    expect(result.current[0].here?.durationSec).toBe(483.2)
    expect(result.current[0].copy?.durationSec).toBe(447.9)
  })

  it('reports measuring until every fact is in', async () => {
    setApi({
      spectrogram: vi.fn(async (path: string) => spectrumFor(path)),
      loudness: vi.fn().mockResolvedValue(loudness),
      fingerprint: vi.fn().mockResolvedValue('abc'),
      comparePair: vi.fn(() => new Promise(() => {})),
      properties: vi.fn().mockResolvedValue(null),
      readDuration: vi.fn().mockResolvedValue(300),
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
