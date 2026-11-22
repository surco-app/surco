import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { TrackProperties } from '../../../shared/types'
import { analysisOptions } from '../lib/analysisQueries'

export function trackPropertiesOptions(inputPath: string) {
  return analysisOptions('properties', inputPath, () => window.api.properties(inputPath))
}

// Probes the read-only technical facts (codec, bit depth, channels, bitrate, size,
// timestamps) for one input. Keyed by path so switching tracks reads the right
// facts and revisiting a track never re-probes. Disabled in multi-select, where the
// panel is hidden and there is no single source to inspect.
export function useTrackProperties(
  inputPath: string,
  enabled: boolean,
): UseQueryResult<TrackProperties | null> {
  return useQuery({
    ...trackPropertiesOptions(inputPath),
    enabled,
  })
}
