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

  function failingCopyApi(over: Record<string, unknown>): void {
    setApi({
      spectrogram: vi.fn(async (path: string) => spectrumFor(path)),
      loudness: vi.fn().mockResolvedValue(loudness),
      fingerprint: vi.fn().mockResolvedValue('abc'),
      comparePair: vi.fn().mockResolvedValue(null),
      properties: vi.fn(async (path: string) => (path === '/lib/gone.mp3' ? null : properties)),
      fileExists: vi.fn().mockResolvedValue(false),
      ...over,
    })
  }

  function renderGone() {
    return renderHook(() => useCopyVerdicts('/here/a.mp3', ['/lib/gone.mp3', '/lib/worse.mp3']), {
      wrapper,
    })
  }

  // A failed probe alone does not say the file is gone: «Not found» is only true once the
  // file is checked and really is not there. The main process answers a failed probe with
  // null, and a rejected call fails the same way.
  it.each([
    ['answers null', async () => null],
    ['rejects', async () => Promise.reject(new Error('ENOENT'))],
  ])(
    'reports a copy missing when its properties %s and the file is not there',
    async (_how, failed) => {
      failingCopyApi({
        properties: vi.fn((path: string) =>
          path === '/lib/gone.mp3' ? failed() : Promise.resolve(properties),
        ),
      })
      const { result } = renderGone()
      await waitFor(() => expect(result.current[0].missing).toBe(true))
      expect(result.current[0].unreadable).toBe(false)
      await waitFor(() => expect(result.current[1].format).toBe('MP3 320'))
      expect(result.current[1]).toMatchObject({ missing: false, unreadable: false })
    },
  )

  // A file that is there but cannot be probed is not «not found»; saying so would send the
  // DJ looking for a drive that is mounted.
  it('reports a copy unreadable, not missing, when the file is there but cannot be read', async () => {
    const props = vi.fn(async (path: string) => (path === '/lib/gone.mp3' ? null : properties))
    failingCopyApi({ properties: props, fileExists: vi.fn().mockResolvedValue(true) })
    const { result } = renderGone()
    await waitFor(() => expect(result.current[0].unreadable).toBe(true))
    expect(result.current[0].missing).toBe(false)
    await new Promise((r) => setTimeout(r, 50))
    expect(props.mock.calls.filter(([path]) => path === '/lib/gone.mp3')).toHaveLength(2)
  })

  // The re-read must not hang on the clock: a probe and a file check that answer within the
  // same millisecond (fast disk, loaded machine) once left the first, possibly stale, failure
  // standing as the answer without the promised second read.
  it('reads an unreadable copy a second time even when every answer lands in the same millisecond', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)
    const props = vi.fn(async (path: string) => (path === '/lib/gone.mp3' ? null : properties))
    failingCopyApi({ properties: props, fileExists: vi.fn().mockResolvedValue(true) })
    const { result } = renderGone()
    await waitFor(() => expect(result.current[0].unreadable).toBe(true))
    expect(props.mock.calls.filter(([path]) => path === '/lib/gone.mp3')).toHaveLength(2)
  })

  // The drive was unmounted when the copy was first probed and is back now: the cached null
  // would keep the row unreadable for the whole session, so it is read once more.
  it('reads the properties again when the file turns out to be there after a failed probe', async () => {
    let mounted = false
    const props = vi.fn(async () => (mounted ? properties : null))
    failingCopyApi({
      properties: props,
      fileExists: vi.fn(async () => {
        mounted = true
        return true
      }),
    })
    const { result } = renderHook(() => useCopyVerdicts('/here/a.mp3', ['/lib/gone.mp3']), {
      wrapper,
    })
    await waitFor(() => expect(result.current[0].format).toBe('MP3 320'))
    expect(result.current[0]).toMatchObject({ missing: false, unreadable: false })
  })

  // A probe still running, or a check for the file still running, says nothing yet: a label
  // there would flash on every copy each time a track opens.
  it('reports neither missing nor unreadable while the properties are still being read', async () => {
    const props = vi.fn(() => new Promise(() => {}))
    failingCopyApi({ properties: props })
    const { result } = renderHook(() => useCopyVerdicts('/here/a.mp3', ['/lib/worse.mp3']), {
      wrapper,
    })
    await waitFor(() => expect(props).toHaveBeenCalled())
    await waitFor(() => expect(result.current[0].measuring).toBe(false))
    expect(result.current[0]).toMatchObject({ missing: false, unreadable: false })
  })

  it('reports neither missing nor unreadable while the file check is still running', async () => {
    const fileExists = vi.fn(() => new Promise(() => {}))
    failingCopyApi({ fileExists })
    const { result } = renderGone()
    await waitFor(() => expect(fileExists).toHaveBeenCalledWith('/lib/gone.mp3'))
    expect(result.current[0]).toMatchObject({ missing: false, unreadable: false })
    expect(fileExists).not.toHaveBeenCalledWith('/lib/worse.mp3')
  })

  // A failed probe is not yet «not found» nor «unreadable»: until the file check and the second
  // read answer, the row says it is still checking instead of going blank.
  it('reports checking while a failed probe waits for the file check, and never for a healthy copy', async () => {
    const fileExists = vi.fn(() => new Promise(() => {}))
    failingCopyApi({ fileExists })
    const { result } = renderGone()
    await waitFor(() => expect(fileExists).toHaveBeenCalled())
    expect(result.current[0]).toMatchObject({ checking: true, missing: false, unreadable: false })
    await waitFor(() => expect(result.current[1].format).toBe('MP3 320'))
    expect(result.current[1].checking).toBe(false)
  })

  // A file check that itself fails says nothing about the file being gone, so the copy is
  // treated as there: unreadable after the second read, never «not found».
  it('reports a copy unreadable, not missing, when the file check itself fails', async () => {
    failingCopyApi({ fileExists: vi.fn().mockRejectedValue(new Error('EIO')) })
    const { result } = renderGone()
    await waitFor(() => expect(result.current[0].unreadable).toBe(true))
    expect(result.current[0].missing).toBe(false)
  })

  it('stops checking once the copy is known to be gone', async () => {
    failingCopyApi({})
    const { result } = renderGone()
    await waitFor(() => expect(result.current[0].missing).toBe(true))
    expect(result.current[0].checking).toBe(false)
  })

  it('starts nothing without copies', () => {
    const spectrogram = vi.fn()
    setApi({ spectrogram, loudness: vi.fn(), fingerprint: vi.fn() })
    const { result } = renderHook(() => useCopyVerdicts('/here/a.mp3', []), { wrapper })
    expect(result.current).toEqual([])
    expect(spectrogram).not.toHaveBeenCalled()
  })
})
