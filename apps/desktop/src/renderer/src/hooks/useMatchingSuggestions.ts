import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { type PairSuggestion, suggestPairs } from '../../../shared/matchingSuggestions'
import type { SourceNode } from '../../../shared/types'
import { suggestRoles, withoutSeparators } from '../lib/sessionTree'

export function mixedPlaylistIds(tree: readonly SourceNode[], made: ReadonlySet<string>): string[] {
  return Object.entries(suggestRoles(withoutSeparators(tree)))
    .filter(([id, role]) => role === 'any' && !made.has(id))
    .map(([id]) => id)
    .sort()
}

export function useMatchingSuggestions({
  enabled,
  tree,
  made,
  matched,
  dismissed,
}: {
  enabled: boolean
  tree: readonly SourceNode[] | undefined
  made: readonly string[]
  matched: readonly (readonly [string, string])[] | undefined
  dismissed: readonly string[]
}): PairSuggestion[] {
  const mixed = useMemo(
    () => (enabled && tree ? mixedPlaylistIds(tree, new Set(made)) : []),
    [enabled, tree, made],
  )
  const { data: sequences } = useQuery({
    queryKey: ['source-tree', 'rekordbox', 'played', mixed],
    queryFn: () => window.api.dj.playedTogether('rekordbox', mixed),
    enabled: enabled && tree !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  })
  return useMemo(
    () =>
      enabled && sequences && matched ? suggestPairs(sequences, matched, new Set(dismissed)) : [],
    [enabled, sequences, matched, dismissed],
  )
}
