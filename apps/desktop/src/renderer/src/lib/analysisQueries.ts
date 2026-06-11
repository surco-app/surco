import type { QueryClient } from '@tanstack/react-query'

// The per-path probe families the renderer caches for the whole session, on the
// queryClient premise that a given path probes to the same facts until quit. Two events
// break that premise — an in-place export rewriting the file, and a track leaving the
// list (whose cached spectrogram image would otherwise be retained forever) — and both
// must evict through here so no family is ever missed.
export const ANALYSIS_QUERY_KEYS = ['properties', 'loudness', 'spectrogram', 'bpm', 'key'] as const

export function removeAnalysisQueries(client: QueryClient, inputPath: string): void {
  for (const key of ANALYSIS_QUERY_KEYS) {
    client.removeQueries({ queryKey: [key, inputPath] })
  }
}
