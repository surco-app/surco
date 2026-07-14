import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { BeatgridResult } from '../../../shared/types'
import { analysisOptions } from '../lib/analysisQueries'

// The one definition of a beatgrid cache entry, like waveformOptions/spectrogramOptions:
// the section that re-probes writes the fresh result back through this key and the list
// reads it through the same one, so a hand-spelled key can't fork the family.
export function beatgridOptions(inputPath: string) {
  return analysisOptions('beatgrid', inputPath, () => window.api.beatgrid(inputPath))
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
  return useQuery({ ...beatgridOptions(inputPath), enabled })
}
