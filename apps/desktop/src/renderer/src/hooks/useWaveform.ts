import { queryOptions, type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { WaveformResult } from '../../../shared/types'

// The one definition of a waveform cache entry, shared by the player's strip and the
// hover prefetch so a single drifting key can't fork the cache. Keyed by path so
// revisiting a track re-reads the disk cache instead of re-decoding the entire file.
export function waveformOptions(inputPath: string) {
  return queryOptions({
    queryKey: ['waveform', inputPath],
    queryFn: (): Promise<WaveformResult | null> => window.api.waveform(inputPath),
  })
}

// Whole-track peak envelope for the player's waveform strip. Disabled until there's a
// track to draw — this is the only analysis that decodes the full length, so it must
// not run for a track with no duration yet.
export function useWaveform(
  inputPath: string,
  enabled: boolean,
): UseQueryResult<WaveformResult | null> {
  return useQuery({ ...waveformOptions(inputPath), enabled })
}
