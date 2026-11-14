import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { DjProgram } from '../../../shared/djProgram'
import { type PairSuggestion, suggestPairs } from '../../../shared/matchingSuggestions'
import type { SourceNode, SourcePlaylistEntry } from '../../../shared/types'
import { suggestRoles, withoutSeparators } from '../lib/sessionTree'
import { SOURCE_READ } from '../lib/sourcePrograms'

export function mixedPlaylistIds(tree: readonly SourceNode[], made: ReadonlySet<string>): string[] {
  return Object.entries(suggestRoles(withoutSeparators(tree)))
    .filter(([id, role]) => role === 'any' && !made.has(id))
    .map(([id]) => id)
    .sort()
}

export function pathSequences(
  playlists: readonly (readonly Pick<SourcePlaylistEntry, 'path' | 'separator'>[])[],
): string[][] {
  const sequences: string[][] = []
  for (const rows of playlists) {
    let current: string[] = []
    for (const row of rows) {
      if (row.path && !row.separator) {
        current.push(row.path.normalize('NFC'))
        continue
      }
      if (current.length > 0) sequences.push(current)
      current = []
    }
    if (current.length > 0) sequences.push(current)
  }
  return sequences
}

async function playedTogether(program: DjProgram, mixed: string[]): Promise<string[][]> {
  if (program === 'rekordbox') return window.api.dj.playedTogether('rekordbox', mixed)
  const rows = await Promise.all(mixed.map((id) => SOURCE_READ[program].playlist(id)))
  return pathSequences(rows)
}

export function useMatchingSuggestions({
  program,
  tree,
  made,
  matched,
  dismissed,
}: {
  program: DjProgram | null
  tree: readonly SourceNode[] | undefined
  made: readonly string[]
  matched: readonly (readonly [string, string])[] | undefined
  dismissed: readonly string[]
}): PairSuggestion[] {
  const mixed = useMemo(
    () => (program && tree ? mixedPlaylistIds(tree, new Set(made)) : []),
    [program, tree, made],
  )
  const { data: sequences } = useQuery({
    queryKey: ['source-tree', program, 'played', mixed],
    queryFn: () => playedTogether(program as DjProgram, mixed),
    enabled: program !== null && tree !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  })
  return useMemo(
    () =>
      program && sequences && matched ? suggestPairs(sequences, matched, new Set(dismissed)) : [],
    [program, sequences, matched, dismissed],
  )
}
