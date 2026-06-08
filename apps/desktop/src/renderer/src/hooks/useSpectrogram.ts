import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { SpectrumResult } from '../../../shared/types'

// Computes the spectrogram (and the lossless-cutoff it implies) for one input. Keyed by
// path so it analyses once per file and revisiting never re-runs ffmpeg. Disabled when
// the Quality section is off in Settings. The cache it fills is shared: the hover
// prefetch and the "analyze all" sweep prime the same keys, so opening a warmed track
// is instant, and App's list reads every track's verdict from the same cache.
export function useSpectrogram(
  inputPath: string,
  enabled: boolean,
): UseQueryResult<SpectrumResult> {
  return useQuery({
    queryKey: ['spectrogram', inputPath],
    queryFn: () => window.api.spectrogram(inputPath),
    enabled,
  })
}
