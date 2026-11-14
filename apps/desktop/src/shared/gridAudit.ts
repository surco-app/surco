import { nearestBeatMs } from './cueGrid'

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

const folded = (ms: number, span: number): number => ms - Math.round(ms / span) * span

function steadyWindows(audit: GridAudit, kicks: number[]): GridAudit['windows'] | null {
  const { windows, total, periodMs } = audit
  if (windows.length < MIN_WINDOWS || windows.length < MIN_HEARD_SHARE * total) return null
  const half = periodMs / 2
  const anchors = windows.map(({ ms, offsetMs }) => nearestBeatMs(ms + offsetMs, kicks))
  const offsets: number[] = []
  for (const [i, { ms, offsetMs }] of windows.entries()) {
    const fromKick = ms + offsetMs - anchors[i]
    const fromKickFolded = Math.abs(fromKick) > periodMs / 4 ? folded(fromKick, half) : fromKick
    const previous = offsets.at(-1)
    const wrapped =
      previous === undefined
        ? fromKickFolded
        : Math.abs(fromKickFolded - previous - half) <= JUMP_MS
          ? fromKickFolded - half
          : Math.abs(fromKickFolded - previous + half) <= JUMP_MS
            ? fromKickFolded + half
            : fromKickFolded
    offsets.push(wrapped)
  }
  const centre = Math.round(median(offsets) / half) * half
  const runs: GridAudit['windows'][] = []
  windows.forEach(({ ms }, i) => {
    const offsetMs = folded(anchors[i] + offsets[i] - centre - ms, periodMs)
    const run = runs.at(-1)
    const last = run?.at(-1)
    const gapMs = last === undefined ? 0 : Math.max(0, ms - last.ms - STEADY_GAP_MS)
    const reach = JUMP_MS + (DRIFT_MS_PER_SECOND * gapMs) / 1000
    if (run && last && Math.abs(offsetMs - last.offsetMs) <= reach) run.push({ ms, offsetMs })
    else runs.push([{ ms, offsetMs }])
  })
  const longest = Math.max(...runs.map((run) => run.length))
  return runs
    .filter((run) => run.length === longest || run.length >= KEPT_SHARE * windows.length)
    .flat()
}

export function checkOfAudit(audit: GridAudit, kicks: number[]): GridCheck {
  const steady = steadyWindows(audit, kicks)
  if (steady === null)
    return audit.heardPerMinute >= HEARD_PER_MINUTE ? { kind: 'tempo' } : { kind: 'unmeasured' }
  const kept = steady.map((w) => w.offsetMs)
  let sustainedMs = 0
  for (let i = 0; i + SUSTAINED_WINDOWS <= kept.length; i++) {
    const nearest = kept
      .slice(i, i + SUSTAINED_WINDOWS)
      .reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a))
    if (Math.abs(nearest) > Math.abs(sustainedMs)) sustainedMs = nearest
  }
  return { kind: 'measured', medianMs: median(kept), sustainedMs }
}

export function auditNear(
  audit: GridAudit,
  kicks: number[],
  ms: number,
): { hitMs: number; gridMs: number } | null {
  const steady = steadyWindows(audit, kicks)
  if (steady === null || steady.length === 0) return null
  const near = steady.reduce((a, b) => (Math.abs(b.ms - ms) < Math.abs(a.ms - ms) ? b : a))
  return { hitMs: near.ms + near.offsetMs, gridMs: -near.offsetMs }
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
