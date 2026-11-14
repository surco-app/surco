export interface GridAudit {
  windows: { ms: number; offsetMs: number }[]
  total: number
  periodMs: number
  heardPerMinute: number
}

export type GridCheck =
  | { kind: 'unmeasured' }
  | { kind: 'tempo' }
  | { kind: 'measured'; medianMs: number; sustainedMs: number }

export type GridVerdict =
  | { kind: 'shifted'; ms: number }
  | { kind: 'partial'; ms: number }
  | { kind: 'tempo' }

const MIN_WINDOWS = 6
const MIN_HEARD_SHARE = 0.25
const HEARD_PER_MINUTE = 10
const JUMP_MS = 8
const DRIFT_MS_PER_SECOND = 0.4
const STEADY_GAP_MS = 4000
const KEPT_SHARE = 0.3
const SUSTAINED_WINDOWS = 4

const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[sorted.length >> 1]
}

export function checkOfAudit(audit: GridAudit): GridCheck {
  const { windows, total, periodMs, heardPerMinute } = audit
  if (windows.length < MIN_WINDOWS || windows.length < MIN_HEARD_SHARE * total)
    return heardPerMinute >= HEARD_PER_MINUTE ? { kind: 'tempo' } : { kind: 'unmeasured' }
  const half = periodMs / 2
  const offsets: number[] = []
  for (const { offsetMs } of windows) {
    const previous = offsets.at(-1)
    const wrapped =
      previous === undefined
        ? offsetMs
        : Math.abs(offsetMs - previous - half) <= JUMP_MS
          ? offsetMs - half
          : Math.abs(offsetMs - previous + half) <= JUMP_MS
            ? offsetMs + half
            : offsetMs
    offsets.push(wrapped)
  }
  const centre = Math.round(median(offsets) / half) * half
  const runs: number[][] = []
  windows.forEach(({ ms }, i) => {
    const offset = offsets[i] - centre
    const run = runs.at(-1)
    const gapMs = i === 0 ? 0 : Math.max(0, ms - windows[i - 1].ms - STEADY_GAP_MS)
    const reach = JUMP_MS + (DRIFT_MS_PER_SECOND * gapMs) / 1000
    if (run && Math.abs(offset - (run.at(-1) ?? offset)) <= reach) run.push(offset)
    else runs.push([offset])
  })
  const longest = Math.max(...runs.map((run) => run.length))
  const kept = runs
    .filter((run) => run.length === longest || run.length >= KEPT_SHARE * windows.length)
    .flat()
  let sustainedMs = 0
  for (let i = 0; i + SUSTAINED_WINDOWS <= kept.length; i++) {
    const nearest = kept
      .slice(i, i + SUSTAINED_WINDOWS)
      .reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a))
    if (Math.abs(nearest) > Math.abs(sustainedMs)) sustainedMs = nearest
  }
  return { kind: 'measured', medianMs: median(kept), sustainedMs }
}

export function gridVerdictOf(check: GridCheck, toleranceMs: number): GridVerdict | null {
  if (check.kind === 'tempo') return { kind: 'tempo' }
  if (check.kind === 'unmeasured') return null
  const shifted = Math.round(check.medianMs)
  if (Math.abs(shifted) > toleranceMs) return { kind: 'shifted', ms: shifted }
  const partial = Math.round(check.sustainedMs)
  if (Math.abs(partial) > toleranceMs) return { kind: 'partial', ms: partial }
  return null
}

export function needsGridFix(check: GridCheck, toleranceMs: number): boolean {
  return gridVerdictOf(check, toleranceMs) !== null
}
