import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { unionPathPairs } from '../lib/matchingPaths'
import { SOURCE_READ } from '../lib/sourcePrograms'
import { useRekordboxMatching } from './useRekordboxMatching'

export const MATCHING_PAIRS_QUERY = ['matching-pairs'] as const

export function useMatchingPathPairs(): [string, string][] {
  const surco = useQuery({
    queryKey: MATCHING_PAIRS_QUERY,
    queryFn: () => window.api.matchingPairs(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const rekordbox = useRekordboxMatching(true)
  const collection = useQuery({
    queryKey: ['source-collection', 'rekordbox'],
    queryFn: () => SOURCE_READ.rekordbox.collection?.() ?? Promise.resolve([]),
    enabled: (rekordbox.data?.length ?? 0) > 0,
    staleTime: 60_000,
  })
  return useMemo(
    () =>
      unionPathPairs(
        surco.data ?? [],
        rekordbox.data ?? [],
        new Map(
          (collection.data ?? []).flatMap((t) => (t.path ? [[t.contentId, t.path] as const] : [])),
        ),
      ),
    [surco.data, rekordbox.data, collection.data],
  )
}
