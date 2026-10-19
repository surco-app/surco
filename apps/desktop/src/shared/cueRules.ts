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

export const COLOR_BY_KIND: Record<CountdownKind, number> = { 16: 1, 32: 22, 48: 42, inicio: 32 }
export const HOT_KINDS = [1, 2, 3, 5, 6, 7, 8, 9]

export interface ExistingCue {
  id: string
  ms: number
  kind: number
  color: number | null
}

export interface CueChangeSet {
  insert: { ms: number; kind: number; color: number | null }[]
  update: { id: string; kind: number; color: number }[]
  remove: string[]
}

export interface DrawnHotCue {
  ms: number
  kind: number
  color: number
}

export type CueOutcome =
  | { status: 'plan'; changes: CueChangeSet; hot: DrawnHotCue[] }
  | { status: 'manual'; changes: CueChangeSet }
  | { status: 'too-many'; needed: number }

const near = (a: number, b: number): boolean => Math.abs(a - b) <= SAME_POSITION_MS

export function isEmptyChange(changes: CueChangeSet): boolean {
  return changes.insert.length === 0 && changes.update.length === 0 && changes.remove.length === 0
}

export function cueChanges(
  existing: ExistingCue[],
  drops: number[],
  previousDrops: number[],
  beats: number[],
  strong: StrongPart[],
): CueOutcome {
  const hot = existing.filter((c) => c.kind !== 0)
  const memory = existing.filter((c) => c.kind === 0)
  const wantedDrops = [...new Set(drops)].sort((a, b) => a - b)
  const currentDrops = memory.filter((m) => hot.every((h) => !near(m.ms, h.ms)))
  const changes: CueChangeSet = {
    insert: wantedDrops
      .filter((ms) => !memory.some((m) => near(m.ms, ms)))
      .map((ms) => ({ ms, kind: 0, color: null })),
    update: [],
    remove: currentDrops.filter((m) => !wantedDrops.some((d) => near(d, m.ms))).map((m) => m.id),
  }
  const plan = planCues(wantedDrops, beats, strong)
  const oldPlan = planCues(previousDrops, beats, strong)
  const fits = hot.every((h) => fitsPlan([h.ms], plan) || fitsPlan([h.ms], oldPlan))
  if (!fits) return { status: 'manual', changes }

  const wanted: PlannedCue[] = [
    ...plan,
    ...hot
      .filter((h) => h.ms < START_MS && plan.every((p) => !near(h.ms, p.ms)))
      .map((h) => ({ ms: h.ms, kind: 'inicio' as const })),
  ].sort((a, b) => a.ms - b.ms)
  if (wanted.length > MAX_HOT_CUES) return { status: 'too-many', needed: wanted.length }

  const used = new Set<string>()
  const drawn: DrawnHotCue[] = wanted.map((w, i) => {
    const kind = HOT_KINDS[i]
    const color = COLOR_BY_KIND[w.kind]
    const there = hot.find((h) => !used.has(h.id) && near(h.ms, w.ms))
    if (there) {
      used.add(there.id)
      if (there.kind !== kind || there.color !== color)
        changes.update.push({ id: there.id, kind, color })
    } else changes.insert.push({ ms: w.ms, kind, color })
    if (
      !memory.some((m) => near(m.ms, w.ms)) &&
      !changes.insert.some((c) => c.kind === 0 && near(c.ms, w.ms))
    )
      changes.insert.push({ ms: w.ms, kind: 0, color: null })
    return { ms: there ? there.ms : w.ms, kind, color }
  })
  for (const h of hot) {
    if (used.has(h.id)) continue
    changes.remove.push(h.id)
    const pairedMemory = memory.find(
      (m) =>
        near(m.ms, h.ms) &&
        !changes.remove.includes(m.id) &&
        !wantedDrops.some((d) => near(d, m.ms)),
    )
    if (pairedMemory) changes.remove.push(pairedMemory.id)
  }
  return { status: 'plan', changes, hot: drawn }
}
