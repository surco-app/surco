import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { BeatgridResult } from '../../../shared/types'
import { analysisOptions } from '../lib/analysisQueries'

// The one definition of a beatgrid cache entry, like waveformOptions/spectrogramOptions:
// the section that re-probes writes the fresh result back through this key and the list
// reads it through the same one, so a hand-spelled key can't fork the family.
export function beatgridOptions(inputPath: string, priority: 'high' | 'low' = 'low') {
  // Priority rides into the analysis limiter, not the cache key: the section asks 'high' so
  // its decode jumps ahead of a background sweep's 'low' floods, filling the same shared
  // entry the list reads. fresh is left undefined — the hook never re-detects; that path
  // runs through GridSection's own beatgrid(path, true) call.
  return analysisOptions('beatgrid', inputPath, () =>
    window.api.beatgrid(inputPath, undefined, priority),
  )
}

// Detects the beatgrid (tempo + first-beat anchor) of one input by decoding its
// opening minutes in main. Keyed by path so switching tracks reads the right
// grid and revisiting never re-decodes. Disabled while the grid section is
// folded (and in multi-select) — there is nothing to draw. A beatless track
// resolves null and the section simply shows no detected grid.
export function useBeatgrid(
  inputPath: string,
  enabled: boolean,
): UseQueryResult<BeatgridResult | null> {
  // The grid section mounts this only for the selected track, the one the user is waiting on,
  // so it asks 'high' to preempt a background sweep's 'low' decodes in the analysis limiter.
  return useQuery({ ...beatgridOptions(inputPath, 'high'), enabled })
}
