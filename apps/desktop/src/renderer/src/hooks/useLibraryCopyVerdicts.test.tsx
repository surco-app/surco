// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { LoudnessResult, SpectrumResult } from '../../../shared/types'
import { buildLibraryIndex } from '../lib/appleMusicLibrary'
import { createQueryClient } from '../lib/queryClient'
import { installApi } from '../test/api'
import type { TrackItem } from '../types'
import { resetLibraryCopyVerdicts, useLibraryCopyVerdicts } from './useLibraryCopyVerdicts'

afterEach(resetLibraryCopyVerdicts)

const INDEX = buildLibraryIndex([
  { title: 'Pray', artist: 'Lasgo', durationSec: 300, persistentId: 'AAAAAAAAAAAAAAA1' },
  {
    title: 'Sweet Dreams',
    artist: 'Eurythmics',
    durationSec: 216,
    persistentId: 'AAAAAAAAAAAAAAA2',
  },
  { title: 'Twice', artist: 'Dup', durationSec: 200, persistentId: 'AAAAAAAAAAAAAAA3' },
  { title: 'Twice', artist: 'Dup', durationSec: 200, persistentId: 'AAAAAAAAAAAAAAA4' },
])

const LIBRARY_FILE: Record<string, string> = {
  AAAAAAAAAAAAAAA1: '/Music/Lasgo - Pray.m4a',
  AAAAAAAAAAAAAAA2: '/Music/Eurythmics - Sweet Dreams.mp3',
}

function track(id: string, title: string, artist: string, over: Partial<TrackItem> = {}) {
  return {
    id,
    inputPath: `/drop/${id}.flac`,
    meta: { title, artist },
    duration: over.duration ?? 300,
    status: 'idle',
    inLibrary: true,
    ...over,
  } as TrackItem
}

const PRAY = track('pray', 'Pray', 'Lasgo')
const DREAMS = track('dreams', 'Sweet Dreams', 'Eurythmics', { duration: 216 })

function spectrum(path: string): SpectrumResult {
  const lossy = /\.(mp3|m4a)$/.test(path)
  return {
    image: '',
    cutoffHz: lossy ? 16000 : 22050,
    sampleRateHz: 44100,
    processed: false,
    hasKnee: lossy,
    codec: path.endsWith('.m4a') ? 'aac' : undefined,
  } as SpectrumResult
}

const LOUD = {
  integratedLufs: -9,
  truePeakDb: -0.3,
  lra: 5,
  crestDb: 12,
  peakCount: 1,
} as LoudnessResult

function api(over: Partial<Api> = {}) {
  const calls = {
    appleMusicEntryLocation: vi.fn<Api['appleMusicEntryLocation']>(
      async (id) => LIBRARY_FILE[id] ?? '',
    ),
    spectrogram: vi.fn<Api['spectrogram']>(async (path) => spectrum(path)),
    loudness: vi.fn<Api['loudness']>(async () => LOUD),
    fingerprint: vi.fn<Api['fingerprint']>(async (path) => `fp:${path}`),
    comparePair: vi.fn<Api['comparePair']>(async () => null),
    ...over,
  }
  installApi(calls)
  return calls
}

function wrapper(
  client = createQueryClient(),
): ({ children }: { children: React.ReactNode }) => React.JSX.Element {
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useLibraryCopyVerdicts', () => {
  it('measures nothing until the filter asks, since each pair means decoding two files', () => {
    const calls = api()
    const { result } = renderHook(() => useLibraryCopyVerdicts([PRAY, DREAMS], INDEX, false), {
      wrapper: wrapper(),
    })
    expect(calls.appleMusicEntryLocation).not.toHaveBeenCalled()
    expect(calls.spectrogram).not.toHaveBeenCalled()
    expect(result.current.total).toBe(2)
    expect(result.current.done).toBe(0)
  })

  it('compares each file with the copy Apple Music already holds, the way the editor does, so a lossless file beats a lossy copy', async () => {
    const calls = api()
    const { result } = renderHook(() => useLibraryCopyVerdicts([PRAY, DREAMS], INDEX, true), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.done).toBe(2))
    expect(result.current.verdictOf(PRAY)).toMatchObject({ winner: 'a' })
    expect(result.current.verdictOf(DREAMS)).toMatchObject({ winner: 'a' })
    expect(calls.spectrogram).toHaveBeenCalledWith('/Music/Lasgo - Pray.m4a', 'low')
    expect(calls.comparePair).toHaveBeenCalledTimes(2)
  })

  it('does not call a lossy file an upgrade over a lossless library copy', async () => {
    api({ appleMusicEntryLocation: vi.fn(async () => '/Music/Lasgo - Pray.aiff') })
    const lossy = track('pray', 'Pray', 'Lasgo', { inputPath: '/drop/pray.mp3' })
    const { result } = renderHook(() => useLibraryCopyVerdicts([lossy], INDEX, true), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.done).toBe(1))
    expect(result.current.verdictOf(lossy)).toMatchObject({ winner: 'b' })
  })

  it('leaves out what has no single library copy to compare with: not owned, owned twice, or added by Surco itself', () => {
    const calls = api()
    const tracks = [
      track('missing', 'Pray', 'Lasgo', { inLibrary: false }),
      track('twice', 'Twice', 'Dup', { duration: 200 }),
      track('added', 'Pray', 'Lasgo', { musicPersistentId: 'BBBBBBBBBBBBBBB1' }),
    ]
    const { result } = renderHook(() => useLibraryCopyVerdicts(tracks, INDEX, true), {
      wrapper: wrapper(),
    })
    expect(result.current.total).toBe(0)
    for (const t of tracks) expect(result.current.verdictOf(t)).toBeUndefined()
    expect(calls.appleMusicEntryLocation).not.toHaveBeenCalled()
  })

  it('gives no verdict when the file in hand IS the library copy, or Music holds no file for it', async () => {
    api({
      appleMusicEntryLocation: vi.fn(async (id) =>
        id === 'AAAAAAAAAAAAAAA1' ? '/DROP/Pray.flac' : '',
      ),
    })
    const own = track('pray', 'Pray', 'Lasgo', { inputPath: '/drop/pray.flac' })
    const { result } = renderHook(() => useLibraryCopyVerdicts([own, DREAMS], INDEX, true), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.done).toBe(2))
    expect(result.current.verdictOf(own)).toBeNull()
    expect(result.current.verdictOf(DREAMS)).toBeNull()
  })

  it('counts a pair it could not measure as done without a verdict, so one unreadable file never stalls the progress', async () => {
    api({ spectrogram: vi.fn().mockRejectedValue(new Error('ENOENT')) })
    const { result } = renderHook(() => useLibraryCopyVerdicts([PRAY], INDEX, true), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.done).toBe(1))
    expect(result.current.verdictOf(PRAY)).toBeNull()
  })

  // The editor measures its open track under the same query keys, and React Query cancels
  // that fetch when the user browses to another row. A pair that joined it must be measured
  // again, not written off as unmeasurable for the rest of the session.
  it('measures a pair again when a fetch it joined is cancelled, instead of keeping it without a verdict', async () => {
    const client = createQueryClient()
    let first = true
    const loudness = vi.fn<Api['loudness']>(() => {
      if (!first) return Promise.resolve(LOUD)
      first = false
      return new Promise(() => {})
    })
    api({ loudness })
    const { result } = renderHook(() => useLibraryCopyVerdicts([PRAY], INDEX, true), {
      wrapper: wrapper(client),
    })
    await waitFor(() => expect(loudness).toHaveBeenCalled())
    await act(() => client.cancelQueries({ queryKey: ['loudness'] }))
    await waitFor(() => expect(result.current.done).toBe(1))
    expect(result.current.verdictOf(PRAY)).toMatchObject({ winner: 'a' })
  })

  it('keeps what it measured for the session, so turning the filter on again is instant', async () => {
    const calls = api()
    const first = renderHook(() => useLibraryCopyVerdicts([PRAY], INDEX, true), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(first.result.current.done).toBe(1))
    first.unmount()
    const again = renderHook(() => useLibraryCopyVerdicts([PRAY], INDEX, true), {
      wrapper: wrapper(),
    })
    expect(again.result.current.done).toBe(1)
    expect(calls.appleMusicEntryLocation).toHaveBeenCalledTimes(1)
  })

  it('stops starting pairs when the filter is turned off', async () => {
    let release: () => void = () => {}
    const appleMusicEntryLocation = vi.fn<Api['appleMusicEntryLocation']>(
      () =>
        new Promise((resolve) => {
          release = () => resolve('')
        }),
    )
    api({ appleMusicEntryLocation })
    const many = Array.from({ length: 6 }, (_, i) =>
      track(`p${i}`, 'Pray', 'Lasgo', { inputPath: `/drop/p${i}.flac` }),
    )
    const { rerender } = renderHook(({ on }) => useLibraryCopyVerdicts(many, INDEX, on), {
      wrapper: wrapper(),
      initialProps: { on: true },
    })
    await waitFor(() => expect(appleMusicEntryLocation).toHaveBeenCalled())
    const asked = appleMusicEntryLocation.mock.calls.length
    rerender({ on: false })
    await act(async () => release())
    expect(appleMusicEntryLocation).toHaveBeenCalledTimes(asked)
  })
})
