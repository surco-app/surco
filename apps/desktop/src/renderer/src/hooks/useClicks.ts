import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import { analysisOptions } from '../lib/analysisQueries'

export interface TrackClicks {
  count: number
  marks: number[]
  scannedSec: number
}

// The track's audible clicks: the count for the header pill and the positions the wave
// marks. One probe for both, so the pill's number and the marks on the wave are always
// the same finding. Keyed by path like every probe, so revisiting a track never
// re-detects; gated on the section being open (the caller's `enabled`), so a folded
// section costs nothing. A failed detection resolves null and the readouts hide —
// never guesses.
export function useClicks(inputPath: string, enabled: boolean): UseQueryResult<TrackClicks | null> {
  return useQuery({
    // The repair section mounts this only for the selected track, the one the user is waiting
    // on, so it scans at 'high' to jump ahead of a background sweep's 'low' floods.
    ...analysisOptions('clicks', inputPath, () => window.api.clicks(inputPath, 'high')),
    enabled,
  })
}
