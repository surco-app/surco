import { type QueryObserverResult, useQueries } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
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

// Reuses the previous rank object of every id whose rank did not change, and the previous
// map when none did, so the memoized list and rows skip the render.
function stabilize(
  previous: ReadonlyMap<string, DuplicateRank>,
  computed: ReadonlyMap<string, DuplicateRank>,
): ReadonlyMap<string, DuplicateRank> {
  const next = new Map(
    [...computed].map(([id, r]) => {
      const kept = previous.get(id)
      return [id, kept && sameRank(kept, r) ? kept : r] as const
    }),
  )
  const unchanged =
    next.size === previous.size && [...next].every(([id, r]) => previous.get(id) === r)
  return unchanged ? previous : next
}

const pairKey = (a: string, b: string): string => [a, b].sort().join('\0')

type Row = [id: string, artist: string, title: string, duration: number | null, path: string]

export function useDuplicateRanks(tracks: TrackItem[]): ReadonlyMap<string, DuplicateRank> {
  // Every progress tick hands over a new tracks array; only these fields decide the groups
  // and the probes, so an unrelated change keeps every memo below.
  const signature = JSON.stringify(
    tracks.map(
      (t): Row => [t.id, t.meta.artist ?? '', t.meta.title ?? '', t.duration ?? null, t.inputPath],
    ),
  )
  const { groups, pathById } = useMemo(() => {
    const rows = JSON.parse(signature) as Row[]
    return {
      groups: duplicateGroups(
        rows.map(([id, artist, title, duration]) => ({
          id,
          artist,
          title,
          durationSec: duration ?? undefined,
        })),
      ).filter((g) => g.kind === 'duplicate'),
      pathById: new Map(rows.map(([id, , , , path]) => [id, path])),
    }
  }, [signature])
  const ids = useMemo(() => groups.flatMap((g) => g.ids), [groups])
  const pairIds = useMemo(
    () =>
      groups.flatMap((g) =>
        g.ids.flatMap((a, i) => g.ids.slice(i + 1).map((b) => [a, b] as const)),
      ),
    [groups],
  )
  const factQueries = useMemo(
    () => ids.flatMap((id) => copyFactsQueries(pathById.get(id) ?? '')),
    [ids, pathById],
  )
  const pairQueries = useMemo(
    () => pairIds.map(([a, b]) => pairOptions(pathById.get(a) ?? '', pathById.get(b) ?? '')),
    [pairIds, pathById],
  )
  const facts = useQueries({ queries: factQueries, combine: factsData })
  const pairs = useQueries({ queries: pairQueries, combine: pairsData })
  const computed = useMemo(() => {
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
    const pairByKey = new Map(pairIds.map(([a, b], k) => [pairKey(a, b), pairs[k]]))
    const next = new Map<string, DuplicateRank>()
    for (const g of groups) {
      const ranks = rankGroup(
        g.ids.map((id) => factsById.get(id) ?? null),
        (i, j) => pairByKey.get(pairKey(g.ids[i], g.ids[j])),
      )
      ranks?.forEach((r, i) => {
        next.set(g.ids[i], r)
      })
    }
    return next
  }, [groups, ids, pairIds, facts, pairs, pathById])
  // The previous result lives in state, updated during render (React's "storing information
  // from previous renders" pattern), so nothing mutates a ref while rendering.
  const [previous, setPrevious] = useState<ReadonlyMap<string, DuplicateRank>>(() => new Map())
  const stable = useMemo(() => stabilize(previous, computed), [previous, computed])
  if (stable !== previous) setPrevious(stable)
  return stable
}
