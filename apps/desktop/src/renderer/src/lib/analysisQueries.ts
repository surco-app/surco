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
const HEAVY_PROBES = new Set(['waveform', 'spectrogram', 'waveformScan'])

export function analysisOptions<T>(name: string, inputPath: string, probe: () => Promise<T>) {
  return queryOptions({
    queryKey: [name, inputPath],
    queryFn: probe,
    ...(HEAVY_PROBES.has(name) ? { gcTime: HEAVY_PROBE_GC_MS } : {}),
  })
}

// analysisOptions for the selection-driven ('high') probes: consumes the AbortSignal
// React Query fires when the fetch loses its last observer — the user browsed away
// from the track — and forwards the cancellation to the main process, which kills the
// path's in-flight ffmpeg decodes so their limiter slots go to the row now selected.
// Only the 'high' probes wire this: a background prefetch or sweep has no observers to
// lose, and its 'low' work is not registered for cancellation in main anyway.
export function cancellableAnalysisOptions<T>(
  name: string,
  inputPath: string,
  probe: () => Promise<T>,
) {
  return queryOptions({
    queryKey: [name, inputPath],
    queryFn: ({ signal }) => {
      signal.addEventListener('abort', () => void window.api.cancelAnalysis(inputPath), {
        once: true,
      })
      return probe()
    },
    ...(HEAVY_PROBES.has(name) ? { gcTime: HEAVY_PROBE_GC_MS } : {}),
  })
}

// The per-path probe families the renderer caches for the whole session, on the
// queryClient premise that a given path probes to the same facts until quit. Two events
// break that premise — an in-place export rewriting the file, and a track leaving the
// list (whose cached spectrogram image would otherwise be retained forever) — and both
// must evict through here so no family is ever missed.
const ANALYSIS_QUERY_KEYS = [
  'properties',
  'loudness',
  'spectrogram',
  'bpm',
  'key',
  'waveform',
  'waveformScan',
  'clicks',
] as const

export function removeAnalysisQueries(client: QueryClient, inputPath: string): void {
  for (const key of ANALYSIS_QUERY_KEYS) {
    client.removeQueries({ queryKey: [key, inputPath] })
  }
}

// The list's one-shot warm-up on import: one IPC round trip for the whole new batch,
// seeding React Query straight from whatever the main process already had on disk so the
// quality dot and clipping flag can render before any probe runs. Only the two families
// tracksSnapshot.ts's SNAPSHOT_FAMILIES actually reads for verdicts/filters — spectrogram
// and waveformScan — round-trip here; loadCachedAnalyses (audio:cached-batch) never
// returns the others. A path missing from the response, or missing one of the two keys,
// is left alone: no placeholder is written, so the family's normal lazy probe still runs
// for it exactly like before this hydration existed. setQueryData is skipped whenever the
// key already holds data — an instant re-drop or a hover prefetch that beat this call must
// keep its fresher in-session result, never get clobbered by a same-or-older disk entry.
export async function seedCachedAnalyses(client: QueryClient, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const batch = await window.api.loadCachedAnalyses(paths)
  for (const [path, hit] of Object.entries(batch)) {
    if (hit.spectrogram && client.getQueryData(['spectrogram', path]) === undefined) {
      client.setQueryData(['spectrogram', path], hit.spectrogram)
    }
    if (hit.waveformScan && client.getQueryData(['waveformScan', path]) === undefined) {
      client.setQueryData(['waveformScan', path], hit.waveformScan)
    }
  }
}
