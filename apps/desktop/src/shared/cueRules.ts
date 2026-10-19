export const SAME_POSITION_MS = 50
export const START_MS = 3000
export const BAR_TOLERANCE = 0.25
export const BEATS_PER_BAR = 4
export const DISTANCES = [16, 32, 48] as const
export const MAX_HOT_CUES = 8
export const TRIM_ORDER = [48, 32] as const
export const CHORUS_BY_MOOD: Record<number, number> = { 1: 5, 2: 9, 3: 9 }

export type CountdownKind = 16 | 32 | 48 | 'inicio'

export interface PlannedCue {
  ms: number
  kind: CountdownKind
}

export interface Phrase {
  beat: number
  kind: number
}

export interface StrongPart {
  start: number
  end: number
}

export function findDrops(memoryMs: number[], hotMs: number[]): number[] {
  return memoryMs
    .filter((m) => hotMs.every((h) => Math.abs(m - h) > SAME_POSITION_MS))
    .sort((a, b) => a - b)
}

export function classify(
  cueMs: number,
  drops: number[],
  bpm: number,
): { kind: CountdownKind | null; bars: number | null } {
  const following = drops.filter((d) => d > cueMs + SAME_POSITION_MS)
  const bars = following.length > 0 ? (following[0] - cueMs) / (240000 / bpm) : null
  const distance = DISTANCES.find((n) => bars && Math.abs(bars - n) < BAR_TOLERANCE) ?? null
  if (distance === null && cueMs < START_MS) return { kind: 'inicio', bars }
  return { kind: distance, bars }
}

export function nearestBeat(beatsMs: number[], ms: number): number {
  let best = 0
  for (let i = 1; i < beatsMs.length; i++)
    if (Math.abs(beatsMs[i] - ms) < Math.abs(beatsMs[best] - ms)) best = i
  return best
}

export function strongParts(mood: number, phrases: Phrase[], beatsMs: number[]): StrongPart[] {
  const starts = [...phrases.map((p) => p.beat), beatsMs.length]
  const out: StrongPart[] = []
  phrases.forEach((p, i) => {
    const end = starts[i + 1]
    if (p.kind === CHORUS_BY_MOOD[mood] && p.beat <= beatsMs.length)
      out.push({ start: beatsMs[p.beat - 1], end: beatsMs[Math.min(end, beatsMs.length) - 1] })
  })
  return out
}

export function planCues(
  dropsMs: number[],
  beatsMs: number[],
  strong: StrongPart[] = [],
): PlannedCue[] {
  let plan: PlannedCue[] = []
  let previous: number | null = null
  for (const drop of [...dropsMs].sort((a, b) => a - b)) {
    const index = nearestBeat(beatsMs, drop)
    for (const bars of DISTANCES) {
      const back = index - bars * BEATS_PER_BAR
      if (back < 0 || (previous !== null && beatsMs[back] <= previous + SAME_POSITION_MS)) break
      if (strong.some((s) => s.start <= beatsMs[back] && beatsMs[back] < s.end)) break
      plan.push({ ms: beatsMs[back], kind: bars })
    }
    previous = drop
  }
  const firstDrop = dropsMs.length > 0 ? Math.min(...dropsMs) : null
  if (
    firstDrop !== null &&
    !plan.some((p) => p.ms < firstDrop) &&
    beatsMs[0] < firstDrop - SAME_POSITION_MS
  )
    plan.push({ ms: beatsMs[0], kind: 'inicio' })
  for (const kind of TRIM_ORDER) {
    while (plan.length > MAX_HOT_CUES && plan.some((p) => p.kind === kind)) {
      const earliest = plan.filter((p) => p.kind === kind).reduce((a, b) => (b.ms < a.ms ? b : a))
      plan = plan.filter((p) => p !== earliest)
    }
  }
  return plan.sort((a, b) => a.ms - b.ms)
}

export function fitsPlan(existingHotMs: number[], plan: PlannedCue[]): boolean {
  return existingHotMs.every(
    (ms) => ms < START_MS || plan.some((p) => Math.abs(ms - p.ms) <= SAME_POSITION_MS),
  )
}
