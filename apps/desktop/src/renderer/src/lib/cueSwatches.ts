import type { CueSummary } from '../../../shared/types'
import type { TrackItem } from '../types'

export interface CueSwatch {
  summary: CueSummary
  pending: boolean
}

export function cueSwatchesOf(
  tracks: readonly TrackItem[],
  contentOf: ReadonlyMap<string, string>,
  summaries: Readonly<Record<string, CueSummary>>,
  pendingPaths: ReadonlySet<string>,
  previous: ReadonlyMap<string, CueSwatch>,
): Map<string, CueSwatch> {
  const out = new Map<string, CueSwatch>()
  for (const t of tracks) {
    const contentId = contentOf.get(t.id)
    const summary = contentId === undefined ? undefined : summaries[contentId]
    if (!summary) continue
    const pending = pendingPaths.has(t.inputPath)
    const before = previous.get(t.id)
    out.set(
      t.id,
      before && before.summary === summary && before.pending === pending
        ? before
        : { summary, pending },
    )
  }
  return out
}
