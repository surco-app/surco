import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { BeatgridResult } from '../../../shared/types'
import { analysisOptions } from '../lib/analysisQueries'

// Detects the beatgrid (tempo + first-beat anchor) of one input by decoding its
// opening minutes in main. Keyed by path so switching tracks reads the right
// grid and revisiting never re-decodes. Disabled while the grid section is
// folded (and in multi-select) — there is nothing to draw. A beatless track
// resolves null and the section simply shows no detected grid.
export function useBeatgrid(
  inputPath: string,
  enabled: boolean,
): UseQueryResult<BeatgridResult | null> {
  return useQuery({
    ...analysisOptions('beatgrid', inputPath, () => window.api.beatgrid(inputPath)),
    enabled,
  })
}
