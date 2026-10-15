import type { PairFacts } from '../../../shared/types'
import {
  COPY_MARGINS,
  type CopyFacts,
  type CopyMargins,
  type CopyReason,
  compareCopies,
  isSameAudio,
} from './bestCopy'

export interface DuplicateRank {
  rank: 'best' | 'worse' | 'same'
  count: number
  identical: boolean
  reason?: CopyReason
}

// A copy is best only when it wins or matches against every other copy and wins at least
// once; a tie against any copy disqualifies it, so "same" is only claimed when nothing
// separates them. Each other row reads its own verdict against the best: why it lost, or
// that it matches the best. pairAt is asked with i < j and must answer either direction.
export function rankGroup(
  facts: (CopyFacts | null | undefined)[],
  pairAt: (i: number, j: number) => PairFacts | null | undefined,
  margins: CopyMargins = COPY_MARGINS,
): DuplicateRank[] | null {
  if (facts.some((f) => !f)) return null
  const all = facts as CopyFacts[]
  const count = all.length
  for (let i = 0; i < count; i++)
    for (let j = i + 1; j < count; j++) if (pairAt(i, j) === undefined) return null
  const pair = (i: number, j: number) => (i < j ? pairAt(i, j) : pairAt(j, i))
  const verdict = (i: number, j: number) => compareCopies(all[i], all[j], pair(i, j), margins)
  const identical = all.every((f, i) =>
    all.every((g, j) => i === j || isSameAudio(f, g, pair(i, j))),
  )
  const best = all.findIndex((_, i) => {
    let won = false
    for (let j = 0; j < count; j++) {
      if (j === i) continue
      const v = verdict(i, j)
      if (v.winner === 'b' || v.winner === 'tie') return false
      if (v.winner === 'a') won = true
    }
    return won
  })
  if (best === -1) return all.map(() => ({ rank: 'same', count, identical }))
  const verdicts = all.map((_, i) => (i === best ? null : verdict(best, i)))
  const firstWin = verdicts.find((v) => v?.winner === 'a')
  return verdicts.map((v, i): DuplicateRank => {
    if (!v) {
      return {
        rank: 'best',
        count,
        identical: false,
        reason: firstWin?.winner === 'a' ? firstWin.reason : undefined,
      }
    }
    if (v.winner === 'a') return { rank: 'worse', count, identical: false, reason: v.reason }
    return { rank: 'same', count, identical: isSameAudio(all[best], all[i], pair(best, i)) }
  })
}
