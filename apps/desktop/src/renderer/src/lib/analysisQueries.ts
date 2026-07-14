import { type QueryClient, queryOptions } from '@tanstack/react-query'

// The one definition of a per-path analysis cache entry: a probe keyed by its name and
// the input path, run once per file. Every probe hook (properties, loudness, spectrogram,
// bpm, key, waveform) builds its options here so the `[name, path]` key shape lives in a
// single place — and the eviction below keys off the same tuple — so a probe and its
// eviction can never drift onto different keys, which would probe under one key and evict
// another.
// A waveform's peaks and a spectrogram's PNG are ~0.5 MB per track, where the other probes
// are a handful of numbers. Under the queryClient's session-long default those two would
// retain every analysed track's payload until quit, so a large crate analysed end to end
// never gives the heap back — and the tracks-view's passive observers keep them alive even
// once nothing renders them. Letting them evict a few minutes after their last observer
// unmounts costs nothing on the way back: the main process still caches the result on disk,
// so a re-probe is a file read rather than a re-decode.
export const HEAVY_PROBE_GC_MS = 5 * 60 * 1_000
const HEAVY_PROBES = new Set(['waveform', 'spectrogram'])

export function analysisOptions<T>(name: string, inputPath: string, probe: () => Promise<T>) {
  return queryOptions({
    queryKey: [name, inputPath],
    queryFn: probe,
    ...(HEAVY_PROBES.has(name) ? { gcTime: HEAVY_PROBE_GC_MS } : {}),
  })
}

// The per-path probe families the renderer caches for the whole session, on the
// queryClient premise that a given path probes to the same facts until quit. Two events
// break that premise — an in-place export rewriting the file, and a track leaving the
// list (whose cached spectrogram image would otherwise be retained forever) — and both
// must evict through here so no family is ever missed.
export const ANALYSIS_QUERY_KEYS = [
  'properties',
  'loudness',
  'spectrogram',
  'bpm',
  'key',
  'waveform',
  'clicks',
] as const

export function removeAnalysisQueries(client: QueryClient, inputPath: string): void {
  for (const key of ANALYSIS_QUERY_KEYS) {
    client.removeQueries({ queryKey: [key, inputPath] })
  }
}
