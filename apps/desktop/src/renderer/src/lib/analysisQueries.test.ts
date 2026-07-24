// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  analysisOptions,
  HEAVY_PROBE_GC_MS,
  removeAnalysisQueries,
  seedCachedAnalyses,
} from './analysisQueries'

function setApi(over: Record<string, unknown>): void {
  ;(window as unknown as { api: unknown }).api = over
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('analysisOptions', () => {
  // The probe and its eviction must agree on the exact key tuple. Pinning the shape to
  // [name, path] here is what lets removeAnalysisQueries clear what the hooks cached: if
  // the factory ever built a different shape, eviction would silently miss the entry.
  it('keys every probe by [name, path] and runs the probe lazily', async () => {
    const probe = vi.fn().mockResolvedValue({ ok: true })
    const options = analysisOptions('bpm', '/m/a.wav', probe)
    expect(options.queryKey).toEqual(['bpm', '/m/a.wav'])
    // Building the options must not have run the probe — it runs only when fetched.
    expect(probe).not.toHaveBeenCalled()
    const run = options.queryFn as () => Promise<unknown>
    expect(await run()).toEqual({ ok: true })
  })

  // A waveform's peaks, a spectrogram's image and the clip/channel scan's per-bucket
  // flags are two orders of magnitude larger than the other probes' handful of numbers,
  // and the session-long default would retain every one of them until quit — a 300-track
  // crate analysed end to end never gives the heap back. These evict once nothing renders
  // them; the probe is cheap to repeat because the main process still holds the result on
  // disk. The small families keep the default.
  it('lets the heavy families evict but keeps the cheap facts for the session', () => {
    expect(HEAVY_PROBE_GC_MS).toBeGreaterThan(0)
    expect(HEAVY_PROBE_GC_MS).toBeLessThan(Number.POSITIVE_INFINITY)
    for (const name of ['waveform', 'spectrogram', 'waveformScan']) {
      expect(analysisOptions(name, '/m/a.wav', vi.fn()).gcTime).toBe(HEAVY_PROBE_GC_MS)
    }
    for (const name of ['properties', 'loudness', 'bpm', 'key', 'clicks']) {
      expect(analysisOptions(name, '/m/a.wav', vi.fn()).gcTime).toBeUndefined()
    }
  })
})

describe('seedCachedAnalyses', () => {
  // The whole point: a fresh import's rows show their quality dot and clipping flag the
  // instant the batch IPC resolves, with no per-track probe IPC ever firing for a warm hit.
  it('seeds the spectrogram and waveformScan query data for a cache hit', async () => {
    const client = new QueryClient()
    setApi({
      loadCachedAnalyses: vi.fn().mockResolvedValue({
        '/m/a.wav': { spectrogram: { image: 'x', cutoffHz: 20000, sampleRateHz: 44100 } },
        '/m/b.wav': { waveformScan: { clipped: [true] } },
      }),
    })

    await seedCachedAnalyses(client, ['/m/a.wav', '/m/b.wav'])

    expect(client.getQueryData(['spectrogram', '/m/a.wav'])).toEqual({
      image: 'x',
      cutoffHz: 20000,
      sampleRateHz: 44100,
    })
    expect(client.getQueryData(['waveformScan', '/m/b.wav'])).toEqual({ clipped: [true] })
  })

  // A path with no cached entry either family must be left untouched — no placeholder,
  // no empty object — so the normal lazy probe still runs for it exactly like today.
  it('leaves a cache miss unset so the normal lazy probe still runs', async () => {
    const client = new QueryClient()
    setApi({ loadCachedAnalyses: vi.fn().mockResolvedValue({}) })

    await seedCachedAnalyses(client, ['/m/a.wav'])

    expect(client.getQueryData(['spectrogram', '/m/a.wav'])).toBeUndefined()
    expect(client.getQueryData(['waveformScan', '/m/a.wav'])).toBeUndefined()
  })

  // A track already probed this session (e.g. an instant re-drop, or a hover prefetch
  // that beat the batch) must keep its fresher in-session result — the disk cache can be
  // older than what just landed, and clobbering it would flash a stale verdict back in.
  it('does not overwrite a query key that already has data', async () => {
    const client = new QueryClient()
    client.setQueryData(['spectrogram', '/m/a.wav'], {
      image: 'fresh',
      cutoffHz: 1,
      sampleRateHz: 1,
    })
    setApi({
      loadCachedAnalyses: vi.fn().mockResolvedValue({
        '/m/a.wav': { spectrogram: { image: 'stale', cutoffHz: 2, sampleRateHz: 2 } },
      }),
    })

    await seedCachedAnalyses(client, ['/m/a.wav'])

    expect(client.getQueryData(['spectrogram', '/m/a.wav'])).toEqual({
      image: 'fresh',
      cutoffHz: 1,
      sampleRateHz: 1,
    })
  })

  // An empty batch (nothing new to hydrate) must not call the IPC at all — the whole
  // point is one round trip per load, not one for a no-op.
  it('skips the IPC call for an empty path list', async () => {
    const client = new QueryClient()
    const loadCachedAnalyses = vi.fn()
    setApi({ loadCachedAnalyses })

    await seedCachedAnalyses(client, [])

    expect(loadCachedAnalyses).not.toHaveBeenCalled()
  })

  // A many-hundred-track reopen must not structured-clone one giant IPC message: paths
  // are sliced into chunks of 200, one invoke per chunk, sequentially.
  it('chunks a large batch into slices of 200 paths per IPC call', async () => {
    const client = new QueryClient()
    const loadCachedAnalyses = vi.fn().mockResolvedValue({})
    setApi({ loadCachedAnalyses })
    const paths = Array.from({ length: 250 }, (_, i) => `/m/${i}.wav`)

    await seedCachedAnalyses(client, paths)

    expect(loadCachedAnalyses).toHaveBeenCalledTimes(2)
    expect(loadCachedAnalyses).toHaveBeenNthCalledWith(1, paths.slice(0, 200))
    expect(loadCachedAnalyses).toHaveBeenNthCalledWith(2, paths.slice(200))
  })

  // Hydration is opportunistic: a rejected IPC call (main process error, dropped
  // channel) must not reject the returned promise — the caller fires this without a
  // catch, so a rejection here would surface as an unhandled rejection toast.
  it('does not propagate a rejected IPC call', async () => {
    const client = new QueryClient()
    setApi({ loadCachedAnalyses: vi.fn().mockRejectedValue(new Error('ipc down')) })

    await expect(seedCachedAnalyses(client, ['/m/a.wav'])).resolves.toBeUndefined()
  })
})

describe('removeAnalysisQueries', () => {
  // The renderer caches every per-path probe for the whole session on the premise that
  // a file's facts never change. An in-place rewrite or a removed track breaks the
  // premise for one path — eviction must clear that path's facts and only that path's.
  it('drops every probe family for the path and leaves other paths alone', () => {
    const client = new QueryClient()
    for (const key of ['properties', 'loudness', 'spectrogram', 'bpm', 'key', 'waveform']) {
      client.setQueryData([key, '/m/a.wav'], { fact: key })
      client.setQueryData([key, '/m/b.wav'], { fact: key })
    }

    removeAnalysisQueries(client, '/m/a.wav')

    for (const key of ['properties', 'loudness', 'spectrogram', 'bpm', 'key', 'waveform']) {
      expect(client.getQueryData([key, '/m/a.wav'])).toBeUndefined()
      expect(client.getQueryData([key, '/m/b.wav'])).toEqual({ fact: key })
    }
  })
})
