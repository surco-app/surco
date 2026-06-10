import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { BpmResult } from '../../../shared/types'

// Detects the tempo of one input by decoding its opening minutes in main. Keyed
// by path so switching tracks reads the right tempo and revisiting never
// re-decodes. Disabled when the bpm field is hidden (or in multi-select) —
// there is nowhere to suggest the value. A beatless track resolves null and
// the suggestion chip simply doesn't render.
export function useBpm(inputPath: string, enabled: boolean): UseQueryResult<BpmResult | null> {
  return useQuery({
    queryKey: ['bpm', inputPath],
    queryFn: () => window.api.bpm(inputPath),
    enabled,
  })
}
