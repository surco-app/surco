import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { WaveformResult } from '../../../shared/types'

// Whole-track peak envelope for the editor's waveform strip. Keyed by path so
// revisiting a track re-reads the disk cache instead of re-decoding the entire
// file. Disabled until there's a track to draw — this is the only analysis that
// decodes the full length, so it must not run for a track with no duration yet.
export function useWaveform(
  inputPath: string,
  enabled: boolean,
): UseQueryResult<WaveformResult | null> {
  return useQuery({
    queryKey: ['waveform', inputPath],
    queryFn: () => window.api.waveform(inputPath),
    enabled,
  })
}
