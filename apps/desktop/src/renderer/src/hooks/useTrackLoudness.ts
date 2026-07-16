import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { LoudnessResult } from '../../../shared/types'
import { analysisOptions } from '../lib/analysisQueries'

// Measures EBU R128 loudness (plus the astats-derived signal checks) for one input.
// Keyed by path so switching tracks reads the right measurement and revisiting never
// re-measures. Disabled when the readout is turned off in Settings. A failed measure
// resolves null and the readout simply hides — there is nothing to show.
export function useTrackLoudness(
  inputPath: string,
  enabled: boolean,
): UseQueryResult<LoudnessResult | null> {
  return useQuery({
    // The editor mounts this only for the selected track, the one the user is waiting on, so
    // it measures at 'high' to jump ahead of a background sweep's 'low' floods in the limiter.
    ...analysisOptions('loudness', inputPath, () => window.api.loudness(inputPath, 'high')),
    enabled,
  })
}
