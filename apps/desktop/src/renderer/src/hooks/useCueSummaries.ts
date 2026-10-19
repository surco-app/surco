import { useQuery } from '@tanstack/react-query'
import type { CueSummary } from '../../../shared/types'

const NONE: Record<string, CueSummary> = {}

export function useCueSummaries(
  contentIds: string[],
  enabled: boolean,
): Record<string, CueSummary> {
  const key = [...new Set(contentIds)].sort()
  const { data } = useQuery({
    queryKey: ['rekordbox-cue-summary', key],
    queryFn: () => window.api.rekordboxCueSummary(key),
    enabled: enabled && key.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
  })
  return data ?? NONE
}
