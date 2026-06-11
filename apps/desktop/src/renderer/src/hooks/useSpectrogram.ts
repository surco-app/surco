import { queryOptions, type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { SpectrumResult } from '../../../shared/types'

// The one definition of a spectrogram cache entry. Four call sites share the cache —
// this hook, the hover prefetch, the analyze sweep and the list's verdict reader —
// so a single drifting copy of the key would silently fork it.
export function spectrogramOptions(inputPath: string) {
  return queryOptions({
    queryKey: ['spectrogram', inputPath],
    queryFn: (): Promise<SpectrumResult> => window.api.spectrogram(inputPath),
  })
}

// Computes the spectrogram (and the lossless-cutoff it implies) for one input. Keyed by
// path so it analyses once per file and revisiting never re-runs ffmpeg. Disabled when
// the Quality section is off in Settings. The cache it fills is shared: the hover
// prefetch and the "analyze all" sweep prime the same keys, so opening a warmed track
// is instant, and App's list reads every track's verdict from the same cache.
export function useSpectrogram(
  inputPath: string,
  enabled: boolean,
): UseQueryResult<SpectrumResult> {
  return useQuery({ ...spectrogramOptions(inputPath), enabled })
}
