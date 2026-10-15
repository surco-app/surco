import { type QueryObserverResult, useQueries } from '@tanstack/react-query'
import { useMemo, useRef } from 'react'
import type { LoudnessResult, PairFacts, SpectrumVerdict } from '../../../shared/types'
import { type DuplicateRank, rankGroup } from '../lib/duplicateRanks'
import { duplicateGroups } from '../lib/duplicates'
import type { TrackItem } from '../types'
import { copyFactsQueries, pairOptions, toCopyFacts } from './useCopyFacts'

// Only the data reaches the memo below: useQueries structurally shares what combine
// returns, so a settled query that did not change keeps the same tuple.
const factsData = (results: QueryObserverResult[]): unknown[] => results.map((r) => r.data)
const pairsData = (results: QueryObserverResult[]): (PairFacts | null | undefined)[] =>
  results.map((r) => (r.isPending ? undefined : ((r.data as PairFacts | undefined) ?? null)))

function sameRank(a: DuplicateRank | undefined, b: DuplicateRank): boolean {
  return (
    !!a &&
    a.rank === b.rank &&
    a.count === b.count &&
    a.identical === b.identical &&
    a.reason === b.reason
  )
}

export function useDuplicateRanks(tracks: TrackItem[]): ReadonlyMap<string, DuplicateRank> {
  const groups = useMemo(
    () =>
      duplicateGroups(
        tracks.map((t) => ({
          id: t.id,
          artist: t.meta.artist ?? '',
          title: t.meta.title ?? '',
          durationSec: t.duration,
        })),
      ).filter((g) => g.kind === 'duplicate'),
    [tracks],
  )
  const pathById = useMemo(() => new Map(tracks.map((t) => [t.id, t.inputPath])), [tracks])
  const ids = useMemo(() => groups.flatMap((g) => g.ids), [groups])
  const pairIds = useMemo(
    () =>
      groups.flatMap((g) =>
        g.ids.flatMap((a, i) => g.ids.slice(i + 1).map((b) => [a, b] as const)),
      ),
    [groups],
  )
  const facts = useQueries({
    queries: ids.flatMap((id) => copyFactsQueries(pathById.get(id) ?? '')),
    combine: factsData,
  })
  const pairs = useQueries({
    queries: pairIds.map(([a, b]) => pairOptions(pathById.get(a) ?? '', pathById.get(b) ?? '')),
    combine: pairsData,
  })
  const previous = useRef<ReadonlyMap<string, DuplicateRank>>(new Map())
  return useMemo(() => {
    const factsById = new Map(
      ids.map((id, i) => [
        id,
        toCopyFacts(
          pathById.get(id) ?? '',
          facts[i * 3] as SpectrumVerdict | undefined,
          facts[i * 3 + 1] as LoudnessResult | null | undefined,
          facts[i * 3 + 2] as string | null | undefined,
        ),
      ]),
    )
    const pairAt = (a: string, b: string): PairFacts | null | undefined =>
      pairs[pairIds.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a))]
    const next = new Map<string, DuplicateRank>()
    for (const g of groups) {
      const ranks = rankGroup(
        g.ids.map((id) => factsById.get(id) ?? null),
        (i, j) => pairAt(g.ids[i], g.ids[j]),
      )
      ranks?.forEach((r, i) => {
        const kept = previous.current.get(g.ids[i])
        next.set(g.ids[i], kept && sameRank(kept, r) ? kept : r)
      })
    }
    const unchanged =
      next.size === previous.current.size &&
      [...next].every(([id, r]) => previous.current.get(id) === r)
    if (!unchanged) previous.current = next
    return previous.current
  }, [groups, ids, pairIds, facts, pairs, pathById])
}
