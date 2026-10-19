import { type CueFlow, type CueRule, type FlowPhrase, type FlowPlace, MY_FLOW } from './cueFlows'

export const SAME_POSITION_MS = 50
export const START_MS = 3000
export const BAR_TOLERANCE = 0.25
export const BEATS_PER_BAR = 4
export const DISTANCES = [16, 32, 48] as const
export const MAX_HOT_CUES = 8
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
  return evaluateFlow(MY_FLOW, { beats: beatsMs, drops: dropsMs, strong, phrases: [] }).cues.map(
    (c) => ({ ms: c.ms, kind: c.rule === 0 ? (c.bars as 16 | 32 | 48) : 'inicio' }),
  )
}

export function fitsPlan(existingHotMs: number[], plan: { ms: number }[]): boolean {
  return existingHotMs.every(
    (ms) => ms < START_MS || plan.some((p) => Math.abs(ms - p.ms) <= SAME_POSITION_MS),
  )
}

export interface FlowTrack {
  beats: number[]
  drops: number[]
  strong: StrongPart[]
  phrases: FlowPhrase[]
}

export interface FlowCue {
  ms: number
  place: FlowPlace
  color: number | null
  rule: number
  repetition: number
  bars: number
}

export interface FlowPlan {
  cues: FlowCue[]
  trimmed: FlowCue[]
}

const isPlannedHot = (c: FlowCue): boolean => c.place !== 'call'

export function ruleColor(rule: CueRule, repetition: number): number {
  return 'fixed' in rule.color
    ? rule.color.fixed
    : rule.color.each[Math.min(repetition, rule.color.each.length) - 1]
}

function originsOf(rule: CueRule, track: FlowTrack, drops: number[]): number[] {
  if (rule.from === 'drop') return drops
  if (rule.from === 'first-beat') return [track.beats[0]]
  if (rule.from === 'last-beat') return [track.beats[track.beats.length - 1]]
  return track.phrases
    .filter((p) => p.kind === rule.from)
    .map((p) => p.ms)
    .sort((a, b) => a - b)
}

function fitsAround(
  ms: number,
  rule: CueRule,
  previous: number | null,
  next: number | null,
  strong: StrongPart[],
): boolean {
  if (rule.direction === 'forward') return next === null || ms < next - SAME_POSITION_MS
  if (previous !== null && ms <= previous + SAME_POSITION_MS) return false
  return !strong.some((s) => s.start <= ms && ms < s.end)
}

function allowed(
  rule: CueRule,
  ms: number,
  earlier: FlowCue[],
  drops: number[],
  beats: number[],
): boolean {
  if (rule.when === 'first')
    return (
      drops.length > 0 && ms < drops[0] - SAME_POSITION_MS && !earlier.some((c) => c.ms < drops[0])
    )
  if (rule.when === 'clear') {
    const at = nearestBeat(beats, ms)
    return earlier.every((c) => Math.abs(nearestBeat(beats, c.ms) - at) >= BEATS_PER_BAR)
  }
  return true
}

function trimToLimit(cues: FlowCue[]): FlowPlan {
  let kept = cues
  const trimmed: FlowCue[] = []
  const candidates = cues
    .filter((c) => isPlannedHot(c) && c.repetition > 1)
    .sort((a, b) => b.bars - a.bars || a.ms - b.ms)
  for (const c of candidates) {
    if (kept.filter(isPlannedHot).length <= MAX_HOT_CUES) break
    kept = kept.filter((k) => k !== c)
    trimmed.push(c)
  }
  return { cues: [...kept].sort((a, b) => a.ms - b.ms), trimmed }
}

export function evaluateFlow(flow: CueFlow, track: FlowTrack): FlowPlan {
  const { beats } = track
  if (beats.length === 0) return { cues: [], trimmed: [] }
  const drops = [...track.drops].sort((a, b) => a - b)
  const placed: FlowCue[] = []
  flow.rules.forEach((rule, index) => {
    const own: FlowCue[] = []
    const add = (ms: number, repetition: number): void => {
      if ([...placed, ...own].some((c) => Math.abs(c.ms - ms) <= SAME_POSITION_MS)) return
      own.push({
        ms,
        place: rule.place,
        color: rule.place === 'call' ? null : ruleColor(rule, repetition),
        rule: index,
        repetition,
        bars: repetition * rule.bars,
      })
    }
    const origins = originsOf(rule, track, drops)
    origins.forEach((origin, i) => {
      const start = nearestBeat(beats, origin)
      if (rule.bars === 0) {
        if (allowed(rule, beats[start], placed, drops, beats)) add(beats[start], 1)
        return
      }
      const previous = i > 0 ? origins[i - 1] : null
      const next = i + 1 < origins.length ? origins[i + 1] : null
      const step = rule.bars * BEATS_PER_BAR * (rule.direction === 'back' ? -1 : 1)
      const times = rule.repeat === 'edge' ? beats.length : rule.repeat
      for (let k = 1; k <= times; k++) {
        const at = start + k * step
        if (at < 0 || at >= beats.length) break
        const ms = beats[at]
        if (rule.when === 'fits' && !fitsAround(ms, rule, previous, next, track.strong)) break
        if (allowed(rule, ms, placed, drops, beats)) add(ms, k)
      }
    })
    placed.push(...own)
  })
  return trimToLimit(placed)
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
