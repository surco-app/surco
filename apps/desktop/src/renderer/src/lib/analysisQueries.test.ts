import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { analysisOptions, HEAVY_PROBE_GC_MS, removeAnalysisQueries } from './analysisQueries'

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
