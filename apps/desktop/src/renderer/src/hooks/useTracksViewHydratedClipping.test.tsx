// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type React from 'react'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { useTracksView, type ViewCacheEntry } from './useTracksView'

function setApi(): void {
  ;(window as unknown as { api: unknown }).api = {
    platform: 'win32',
    onWindowFocus: () => () => {},
  }
}

function track(
  id: string,
  meta: Partial<TrackMetadata> = {},
  extra: Partial<TrackItem> = {},
): TrackItem {
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

function setup(initialTracks: TrackItem[], client: QueryClient) {
  setApi()
  const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(
    ({ tracks }: { tracks: TrackItem[] }) => {
      const viewCache = useRef(new Map<string, ViewCacheEntry>())
      return useTracksView(tracks, viewCache, 'appleMusic')
    },
    { wrapper, initialProps: { tracks: initialTracks } },
  )
}

const spectrum = { image: 'data:image/png;base64,', cutoffHz: 16000, sampleRateHz: 44100 }

// seedCachedAnalyses hydrates exactly the two families audio:cached-batch returns —
// spectrogram and waveformScan — and its docstring states the purpose: "so the quality
// dot AND CLIPPING FLAG can render before any probe runs". The waveform family is
// deliberately excluded there (its ~0.5 MB peaks payload would make a big library's
// opening batch multi-MB). But useTracksView assigns view.audioIssues only inside
// `if (wave)`, and reads clipping off `scan` from within that gate — so on the exact
// state hydration produces (scan warm, waveform absent) the clipping fact never lands.
// The same hole reappears mid-session: HEAVY_PROBE_GC_MS can collect the waveform while
// the lighter scan entry survives.
describe('the clipping fact must survive a waveform-less hydration', () => {
  it('reports clipping from a hydrated scan when no waveform was hydrated', () => {
    const client = new QueryClient()
    const clipped = Array.from({ length: 200 }, (_, i) => i === 100)
    // Exactly what seedCachedAnalyses writes for a reopened library: the two hydrated
    // families and nothing else. No ['waveform', ...] entry — it is never in the batch.
    client.setQueryData(['spectrogram', '/music/a.wav'], spectrum)
    client.setQueryData(['waveformScan', '/music/a.wav'], { clipped })

    const { result } = setup([track('a')], client)

    // The DJ reopens a library that was fully analysed last session. Every scan is warm
    // on disk and hydrated into the cache, yet the "Clipping" attention filter reads 0
    // and the row shows no attention flag, so they conclude nothing clips.
    expect(result.current.tracksView[0].audioIssues?.clipping).toBe(true)
  })

  it('reports clipping from a surviving scan after the waveform was garbage-collected', () => {
    const client = new QueryClient()
    const peaks = Array.from({ length: 200 }, () => 0.5)
    const clipped = peaks.map((_, i) => i === 100)
    client.setQueryData(['waveform', '/music/a.wav'], { peaks, durationSec: 100 })
    client.setQueryData(['waveformScan', '/music/a.wav'], { clipped })
    const tracks = [track('a')]
    const { result, rerender } = setup(tracks, client)
    expect(result.current.tracksView[0].audioIssues?.clipping).toBe(true)

    // The heavy peaks payload is collected while the lighter scan entry lives on.
    client.removeQueries({ queryKey: ['waveform', '/music/a.wav'] })
    rerender({ tracks })

    // The clipping truth did not change — only the unrelated probe that was holding
    // the gate open went away.
    expect(result.current.tracksView[0].audioIssues?.clipping).toBe(true)
  })
})
