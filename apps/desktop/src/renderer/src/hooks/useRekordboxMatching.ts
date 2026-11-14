import { useQuery } from '@tanstack/react-query'

export const MATCHING_QUERY = ['source-tree', 'rekordbox', 'matching'] as const

export function useRekordboxMatching(enabled = true) {
  return useQuery({
    queryKey: MATCHING_QUERY,
    queryFn: () => window.api.dj.matching('rekordbox'),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })
}
