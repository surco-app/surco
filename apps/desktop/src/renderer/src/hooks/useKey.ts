import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { KeyResult } from '../../../shared/types'
import { analysisOptions } from '../lib/analysisQueries'

// Detects the musical key of one input by decoding its opening minutes in
// main. Keyed by path so switching tracks reads the right key and revisiting
// never re-analyses. Disabled when the key field is hidden (or in
// multi-select) — there is nowhere to suggest the value. An atonal track
// resolves null and the suggestion chip simply doesn't render.
export function useKey(inputPath: string, enabled: boolean): UseQueryResult<KeyResult | null> {
  return useQuery({
    // The editor mounts this only for the selected track, the one the user is waiting on, so
    // it decodes at 'high' to jump ahead of a background sweep's 'low' floods in the limiter.
    ...analysisOptions('key', inputPath, () => window.api.key(inputPath, 'high')),
    enabled,
  })
}
