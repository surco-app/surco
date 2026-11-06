import { createHash } from 'node:crypto'
import type { GridFit } from '../shared/gridEdit'
import { type GridVerdict, gridVerdictOf } from '../shared/gridVerdict'
import { cachedAnalysis } from './analysisCache'

export const GRID_VERDICT_NAMESPACE = 'grid-verdict-v1'

type Kept = { verdict: GridVerdict | null; measured: boolean }

export async function cachedGridVerdict(
  file: string | null,
  grid: { ms: number }[] | undefined,
  measure: () => Promise<GridFit | null>,
): Promise<GridVerdict | null> {
  if (!file || !grid || grid.length < 2) return null
  const beats = grid.map((b) => b.ms)
  const of = createHash('sha1').update(beats.join(',')).digest('hex')
  const kept = await cachedAnalysis<Kept>(
    `${GRID_VERDICT_NAMESPACE} ${of}`,
    file,
    async () => {
      const fit = await measure()
      return { verdict: fit ? gridVerdictOf(beats, fit) : null, measured: fit !== null }
    },
    (k) => k.measured,
  )
  return kept.verdict
}
