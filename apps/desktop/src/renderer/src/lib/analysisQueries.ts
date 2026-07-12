import { type QueryClient, queryOptions } from '@tanstack/react-query'

// The one definition of a per-path analysis cache entry: a probe keyed by its name and
// the input path, run once per file. Every probe hook (properties, loudness, spectrogram,
// bpm, key, waveform) builds its options here so the `[name, path]` key shape lives in a
// single place — and the eviction below keys off the same tuple — so a probe and its
// eviction can never drift onto different keys, which would probe under one key and evict
// another.
export function analysisOptions<T>(name: string, inputPath: string, probe: () => Promise<T>) {
  return queryOptions({ queryKey: [name, inputPath], queryFn: probe })
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
