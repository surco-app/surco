// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type React from 'react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { type ViewCacheEntry, useTracksView } from './useTracksView'

function setApi(): void {
  ;(window as unknown as { api: unknown }).api = {
    // Off macOS the Apple Music snapshot never loads, keeping the library axis out of
    // these tests; the resolved/persistent-id merges are still exercised below.
    platform: 'win32',
    onWindowFocus: () => () => {},
  }
}

function track(id: string, meta: Partial<TrackMetadata> = {}, extra: Partial<TrackItem> = {}): TrackItem {
  return {
    id,
    inputPath: `/music/${id}.wav`,
    fileName: `${id}.wav`,
    listLabel: id,
    query: '',
    status: 'idle',
    meta: { ...emptyMetadata(), ...meta },
    ...extra,
  }
}

const spectrum = { image: 'data:image/png;base64,', cutoffHz: 16000, sampleRateHz: 44100 }

function setup(initialTracks: TrackItem[], client = new QueryClient()) {
  setApi()
  const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const rendered = renderHook(
    ({ tracks }: { tracks: TrackItem[] }) => {
      const viewCache = useRef(new Map<string, ViewCacheEntry>())
      return useTracksView(tracks, viewCache)
    },
    { wrapper, initialProps: { tracks: initialTracks } },
  )
  return { ...rendered, client }
}

afterEach(() => vi.restoreAllMocks())

describe('useTracksView', () => {
  // The list's verdict dots read from the same query cache the hover prefetch, the
  // sweep and the editor fill — the merge is what turns a cached analysis into a
  // visible verdict without re-running ffmpeg.
  it('merges a cached spectrum onto its track', () => {
    const client = new QueryClient()
    client.setQueryData(['spectrogram', '/music/a.wav'], spectrum)
    const { result } = setup([track('a'), track('b')], client)
    expect(result.current.tracksView[0].spectrum).toEqual(spectrum)
    expect(result.current.tracksView[1].spectrum).toBeUndefined()
  })

  // The memoized rows only skip re-rendering if an unchanged track keeps the same view
  // object across renders — this identity contract is what keeps a progress tick on one
  // row from repainting five hundred.
  it('keeps the same view identity for an unchanged track across re-renders', () => {
    const client = new QueryClient()
    client.setQueryData(['spectrogram', '/music/a.wav'], spectrum)
    const a = track('a')
    const b = track('b')
    const { result, rerender } = setup([a, b], client)
    const firstViewA = result.current.tracksView[0]

    // A new array with the same track objects — the shape every progress tick produces.
    rerender({ tracks: [a, b] })
    expect(result.current.tracksView[0]).toBe(firstViewA)
  })

  // A track Surco itself added to Apple Music (musicPersistentId) is owned by
  // definition — it must read in-library even before any snapshot loads.
  it('treats a track it added to Apple Music as owned without a snapshot', () => {
    const { result } = setup([track('a', {}, { musicPersistentId: 'X1' })])
    expect(result.current.tracksView[0].inAppleMusic).toBe(true)
  })

  // Two files carrying the same folded artist+title are the same song twice; the
  // merged flag is what the duplicates filter bucket reads.
  it('flags both halves of a duplicated song', () => {
    const { result } = setup([
      track('a', { title: 'Strobe', artist: 'deadmau5' }),
      track('b', { title: 'Strobe', artist: 'deadmau5' }),
      track('c', { title: 'Ghosts', artist: 'deadmau5' }),
    ])
    expect(result.current.tracksView.map((t) => t.duplicate ?? false)).toEqual([true, true, false])
  })
})
