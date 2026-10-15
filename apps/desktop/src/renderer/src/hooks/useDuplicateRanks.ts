import { type QueryObserverResult, useQueries } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { LoudnessResult, PairFacts, SpectrumVerdict } from '../../../shared/types'
import { type DuplicateRank, rankGroup } from '../lib/duplicateRanks'
import { duplicateGroups } from '../lib/duplicates'
import type { TrackItem } from '../types'
import { copyFactsQueries, pairOptions, toCopyFacts } from './useCopyFacts'
import { useStableCallback } from './useStableCallback'

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

// The fields that decide the groups and the probes, joined per track. A cheap join
// rather than JSON: it runs on every progress tick, and only has to change when they do.
const FIELD = '\u0000'
const ROW = '\u0001'

export interface DuplicateRanks {
  ranks: ReadonlyMap<string, DuplicateRank>
  // The list's row-visibility report (TrackList's onVisible).
  onRowVisible: (id: string, visible: boolean) => void
}

// Ranking decodes every copy and compares every pair, so only the groups whose rows have
// all been on screen are measured: a big library's duplicates nobody scrolled to cost
// nothing. A row seen once stays seen, so a measured group keeps its ranks when it scrolls
// away.
export function useDuplicateRanks(tracks: TrackItem[]): DuplicateRanks {
  // Every progress tick hands over a new tracks array; only these fields decide the groups
  // and the probes, so an unrelated change keeps every memo below.
  const signature = tracks
    .map((t) =>
      [t.id, t.meta.artist ?? '', t.meta.title ?? '', t.duration ?? '', t.inputPath].join(FIELD),
    )
    .join(ROW)
  const { allGroups, pathById } = useMemo(() => {
    const rows = signature ? signature.split(ROW).map((r) => r.split(FIELD)) : []
    return {
      allGroups: duplicateGroups(
        rows.map(([id, artist, title, duration]) => ({
          id,
          artist,
          title,
          durationSec: duration === '' ? undefined : Number(duration),
        })),
      ).filter((g) => g.kind === 'duplicate'),
      pathById: new Map(rows.map(([id, , , , path]) => [id, path])),
    }
  }, [signature])
  const duplicateIds = useMemo(() => new Set(allGroups.flatMap((g) => g.ids)), [allGroups])
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set())
  // Every row reported is remembered, yet only a duplicate's row reaches state: any other
  // row showing would re-render App for nothing. The rest wait here because a row shows
  // with its title parsed from the file name, and the real tags that make it a duplicate
  // arrive after its one report.
  const reported = useRef(new Set<string>())
  const onRowVisible = useStableCallback((id: string, visible: boolean): void => {
    if (!visible) return
    reported.current.add(id)
    if (!duplicateIds.has(id)) return
    setSeen((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  })
  useEffect(() => {
    const shown = [...duplicateIds].filter((id) => reported.current.has(id))
    setSeen((prev) => (shown.every((id) => prev.has(id)) ? prev : new Set([...prev, ...shown])))
  }, [duplicateIds])
  const groups = useMemo(
    () => allGroups.filter((g) => g.ids.every((id) => seen.has(id))),
    [allGroups, seen],
  )
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
  return useMemo(() => ({ ranks: stable, onRowVisible }), [stable, onRowVisible])
}
