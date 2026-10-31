import { SAME_CUE_MS } from './traktorNml'

export interface CueMark {
  type: number
  hotcue: number
  ms: number
}

export interface TraktorPair {
  sourceEntry: CueMark[] | null
  sourceTree: CueMark[] | null
  siblingEntry: CueMark[] | null
  siblingTree: CueMark[] | null
  k: number
  sourceOnBootDisk: boolean
  provenance: boolean
}

export type TraktorJudgement = {
  kind: 'traktor-source-cues' | 'traktor-calibration'
  certainty: 'sure' | 'likely'
  addMs: number
  fixEntry: 'source' | 'sibling'
  fixTree: boolean
  provenance: boolean
}

const OLD_RULES = [-51, 0]
const SURE_CUES = 2

const near = (a: number, b: number) => Math.abs(a - b) <= SAME_CUE_MS

export function offsetBetween(a: CueMark[], b: CueMark[]): number | null {
  if (a.length === 0 || a.length !== b.length) return null
  const byMs = (x: CueMark[]) => [...x].sort((p, q) => p.ms - q.ms)
  const [sa, sb] = [byMs(a), byMs(b)]
  const d = sb[0].ms - sa[0].ms
  const fits = sa.every(
    (c, i) => c.type === sb[i].type && c.hotcue === sb[i].hotcue && near(sb[i].ms - c.ms, d),
  )
  return fits ? d : null
}

const offsetOf = (a: CueMark[] | null, b: CueMark[] | null): number | null =>
  a && b ? offsetBetween(a, b) : null

const sure = (pair: TraktorPair, fromTree: boolean, cues: CueMark[] | null): boolean =>
  fromTree && pair.provenance && (cues?.length ?? 0) >= SURE_CUES

function sourceMoved(pair: TraktorPair): TraktorJudgement | null {
  const { sourceEntry, sourceTree, siblingEntry, siblingTree, k } = pair
  if (!pair.sourceOnBootDisk || near(k, 0)) return null
  const tookSibling = [siblingEntry, siblingTree].some((s) => {
    const d = offsetOf(s, sourceEntry)
    return d !== null && near(d, 0)
  })
  if (!tookSibling) return null
  const fromTree = offsetOf(sourceTree, sourceEntry)
  if (sourceTree && (fromTree === null || !near(fromTree, k))) return null
  return {
    kind: 'traktor-source-cues',
    certainty: sure(pair, sourceTree !== null, sourceEntry) ? 'sure' : 'likely',
    addMs: -k,
    fixEntry: 'source',
    fixTree: false,
    provenance: pair.provenance,
  }
}

function calibrationMissed(pair: TraktorPair): TraktorJudgement | null {
  const reference = pair.sourceTree ?? pair.sourceEntry
  const d = offsetOf(reference, pair.siblingTree ?? pair.siblingEntry)
  if (d === null || near(d, pair.k) || !OLD_RULES.some((rule) => near(d, rule))) return null
  return {
    kind: 'traktor-calibration',
    certainty: sure(pair, pair.sourceTree !== null, reference) ? 'sure' : 'likely',
    addMs: pair.k - d,
    fixEntry: 'sibling',
    fixTree: pair.siblingTree !== null,
    provenance: pair.provenance,
  }
}

export function judgeTraktorPair(pair: TraktorPair): TraktorJudgement[] {
  const moved = sourceMoved(pair)
  if (moved) return pair.sourceTree ? [moved, ...listed(calibrationMissed(pair))] : [moved]
  return listed(calibrationMissed(pair))
}

const listed = (j: TraktorJudgement | null): TraktorJudgement[] => (j ? [j] : [])
