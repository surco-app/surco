import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { SpectrumResult } from '../../../shared/types'
import { analysisOptions } from '../lib/analysisQueries'

// The one definition of a spectrogram cache entry. Four call sites share the cache —
// this hook, the hover prefetch, the analyze sweep and the list's verdict reader —
// so a single drifting copy of the key would silently fork it. The priority rides into
// the analysis limiter (not the cache key): the editor's selected track asks 'high' so
// its decode jumps ahead of a background sweep's 'low' floods; the cache it fills is the
// same one regardless, so a warmed 'low' entry serves the editor with no re-decode.
export function spectrogramOptions(inputPath: string, priority: 'high' | 'low' = 'low') {
  return analysisOptions('spectrogram', inputPath, () =>
    window.api.spectrogram(inputPath, priority),
  )
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
  // The editor mounts this only for the selected track — the one the user is waiting on —
  // so it asks 'high' to preempt a background auto-match sweep's 'low' decodes.
  return useQuery({ ...spectrogramOptions(inputPath, 'high'), enabled })
}
