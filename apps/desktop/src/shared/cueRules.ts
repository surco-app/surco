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

export type RejectReason = 'strong' | 'point' | 'start' | 'end' | 'limit'

export interface RejectedCue extends FlowCue {
  reason: RejectReason
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

function misfit(
  ms: number,
  rule: CueRule,
  previous: number | null,
  next: number | null,
  strong: StrongPart[],
): RejectReason | null {
  if (rule.direction === 'forward')
    return next === null || ms < next - SAME_POSITION_MS ? null : 'point'
  if (previous !== null && ms <= previous + SAME_POSITION_MS) return 'point'
  return strong.some((s) => s.start <= ms && ms < s.end) ? 'strong' : null
}

function beatMsAt(beats: number[], at: number): number {
  if (at >= 0 && at < beats.length) return beats[at]
  const step = beats.length > 1 ? beats[1] - beats[0] : 500
  return at < 0 ? beats[0] + at * step : beats[beats.length - 1] + (at - beats.length + 1) * step
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

function walkFlow(flow: CueFlow, track: FlowTrack): FlowPlan & { rejected: RejectedCue[] } {
  const { beats } = track
  if (beats.length === 0) return { cues: [], trimmed: [], rejected: [] }
  const drops = [...track.drops].sort((a, b) => a - b)
  const placed: FlowCue[] = []
  const rejected: RejectedCue[] = []
  flow.rules.forEach((rule, index) => {
    const own: FlowCue[] = []
    const cueOf = (ms: number, repetition: number): FlowCue => ({
      ms,
      place: rule.place,
      color: rule.place === 'call' ? null : ruleColor(rule, repetition),
      rule: index,
      repetition,
      bars: repetition * rule.bars,
    })
    const add = (ms: number, repetition: number): void => {
      if ([...placed, ...own].some((c) => Math.abs(c.ms - ms) <= SAME_POSITION_MS)) return
      own.push(cueOf(ms, repetition))
    }
    const reject = (
      start: number,
      step: number,
      from: number,
      to: number,
      reason: RejectReason,
    ) => {
      for (let k = from; k <= to; k++)
        rejected.push({ ...cueOf(beatMsAt(beats, start + k * step), k), reason })
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
      const last = rule.repeat === 'edge' ? null : rule.repeat
      for (let k = 1; k <= times; k++) {
        const at = start + k * step
        if (at < 0 || at >= beats.length) {
          if (last !== null) reject(start, step, k, last, at < 0 ? 'start' : 'end')
          break
        }
        const ms = beats[at]
        const reason = rule.when === 'fits' ? misfit(ms, rule, previous, next, track.strong) : null
        if (reason) {
          reject(start, step, k, last ?? k, reason)
          break
        }
        if (allowed(rule, ms, placed, drops, beats)) add(ms, k)
      }
    })
    placed.push(...own)
  })
  const plan = trimToLimit(placed)
  return {
    ...plan,
    rejected: [...rejected, ...plan.trimmed.map((c) => ({ ...c, reason: 'limit' as const }))],
  }
}

export function evaluateFlow(flow: CueFlow, track: FlowTrack): FlowPlan {
  const { cues, trimmed } = walkFlow(flow, track)
  return { cues, trimmed }
}

export function rejectedCues(flow: CueFlow, track: FlowTrack): RejectedCue[] {
  return walkFlow(flow, track).rejected
}

export const HOT_KINDS = [1, 2, 3, 5, 6, 7, 8, 9]

export interface ExistingCue {
  id: string
  ms: number
  kind: number
  color: number | null
  loop?: boolean
}

export interface CueChangeSet {
  insert: { ms: number; kind: number; color: number | null }[]
  update: { id: string; kind: number; color: number | null; ms?: number }[]
  remove: string[]
}

export interface DrawnHotCue {
  ms: number
  kind: number
  color: number | null
}

export interface WantedCue {
  id?: string
  ms: number
  kind: number
  color: number | null
}

export type InvalidWantedReason =
  | 'shape'
  | 'ms'
  | 'id'
  | 'duplicate-id'
  | 'kind'
  | 'duplicate-letter'
  | 'color'
  | 'loop'

const COLOR_TABLE_SIZE = 62

function wantedProblem(w: WantedCue, was: ExistingCue | undefined): InvalidWantedReason | null {
  if (typeof w !== 'object' || w === null) return 'shape'
  if (typeof w.ms !== 'number' || !Number.isFinite(w.ms) || w.ms < 0) return 'ms'
  if (w.id !== undefined && typeof w.id !== 'string') return 'id'
  if (!(w.kind === 0 || HOT_KINDS.includes(w.kind) || (was && was.kind === w.kind))) return 'kind'
  const kept = was !== undefined && was.color === w.color && (was.kind === 0) === (w.kind === 0)
  const color =
    w.kind === 0
      ? w.color === null
      : w.color === null ||
        (Number.isInteger(w.color) && w.color >= 1 && w.color <= COLOR_TABLE_SIZE)
  return color || kept ? null : 'color'
}

export function validWantedSet(
  wanted: WantedCue[],
  existing: ExistingCue[],
): { ok: true } | { ok: false; reason: InvalidWantedReason } {
  if (!Array.isArray(wanted)) return { ok: false, reason: 'shape' }
  const live = new Map(existing.map((c) => [c.id, c]))
  const ids = new Set<string>()
  const letters = new Set<number>()
  for (const w of wanted) {
    const reason = wantedProblem(w, w?.id === undefined ? undefined : live.get(w.id))
    if (reason) return { ok: false, reason }
    if (w.id !== undefined) {
      if (ids.has(w.id)) return { ok: false, reason: 'duplicate-id' }
      ids.add(w.id)
    }
    if (w.kind !== 0) {
      if (letters.has(w.kind)) return { ok: false, reason: 'duplicate-letter' }
      letters.add(w.kind)
    }
  }
  const untouched = (l: ExistingCue): boolean =>
    wanted.some((w) => w.id === l.id && w.ms === l.ms && w.kind === l.kind && w.color === l.color)
  if (!existing.filter((c) => c.loop).every(untouched)) return { ok: false, reason: 'loop' }
  return { ok: true }
}

export type CueOutcome =
  | { status: 'plan'; changes: CueChangeSet; hot: DrawnHotCue[] }
  | { status: 'manual'; changes: CueChangeSet }
  | { status: 'too-many'; needed: number }

const near = (a: number, b: number): boolean => Math.abs(a - b) <= SAME_POSITION_MS

export function proposeDrops(strong: StrongPart[], drops: number[]): number[] {
  return [...new Set(strong.map((s) => s.start))]
    .filter((ms) => drops.every((d) => !near(d, ms)))
    .sort((a, b) => a - b)
}

export function isEmptyChange(changes: CueChangeSet): boolean {
  return changes.insert.length === 0 && changes.update.length === 0 && changes.remove.length === 0
}

export interface FlowInput {
  existing: ExistingCue[]
  drops: number[]
  previousDrops: number[]
  beats: number[]
  strong: StrongPart[]
  phrases: FlowPhrase[]
  flow: CueFlow
  previousFlow?: CueFlow
  point?: number
  kept?: string[]
}

export type FlowOutcome =
  | { status: 'plan'; wanted: WantedCue[]; hot: DrawnHotCue[]; trimmed: number[] }
  | { status: 'manual'; wanted: WantedCue[] }
  | { status: 'too-many'; needed: number }

const keep = (c: ExistingCue): WantedCue => ({ id: c.id, ms: c.ms, kind: c.kind, color: c.color })

export function flowDrops(flow: CueFlow, track: FlowTrack): number[] {
  const all = [...new Set(track.drops)].sort((a, b) => a - b)
  if (!flow.rules.some((r) => r.place === 'call')) return all
  const regenerates = (kept: number[]): boolean => {
    const calls = evaluateFlow(flow, { ...track, drops: kept }).cues.filter(
      (c) => c.place === 'call',
    )
    return all.every((d) => kept.includes(d) || calls.some((c) => near(c.ms, d)))
  }
  let drops = all
  for (let i = 0; i < drops.length; i++) {
    const kept = drops.filter((_, j) => j !== i)
    if (!regenerates(kept)) continue
    drops = kept
    i = -1
  }
  return drops
}

export function flowOutcome(input: FlowInput): FlowOutcome {
  const { existing, beats, strong, phrases, flow } = input
  const hot = existing.filter((c) => c.kind !== 0)
  const memory = existing.filter((c) => c.kind === 0)
  const wantedDrops = flowDrops(flow, { beats, drops: input.drops, strong, phrases })
  const currentDrops = memory.filter((m) => !m.loop && hot.every((h) => !near(m.ms, h.ms)))
  const removed = new Set(
    currentDrops.filter((m) => !wantedDrops.some((d) => near(d, m.ms))).map((m) => m.id),
  )
  const unmarked = (ms: number): boolean =>
    !flow.markPoint && input.point !== undefined && near(ms, input.point)
  const added: WantedCue[] = wantedDrops
    .filter((ms) => !memory.some((m) => near(m.ms, ms)) && !unmarked(ms))
    .map((ms) => ({ ms, kind: 0, color: null }))
  const plan = evaluateFlow(flow, { beats, drops: wantedDrops, strong, phrases })
  const previousFlow = input.previousFlow ?? flow
  const oldPlan = evaluateFlow(previousFlow, {
    beats,
    drops: flowDrops(previousFlow, { beats, drops: input.previousDrops, strong, phrases }),
    strong,
    phrases,
  })
  const hotOf = (p: FlowPlan) => p.cues.filter((c) => c.place !== 'call')
  const fits = hot.every(
    (h) =>
      input.kept?.includes(h.id) ||
      fitsPlan([h.ms], hotOf(plan)) ||
      fitsPlan([h.ms], hotOf(oldPlan)),
  )
  if (!fits)
    return {
      status: 'manual',
      wanted: [...memory.filter((m) => !removed.has(m.id)).map(keep), ...added, ...hot.map(keep)],
    }

  const start = flow.rules.find((r) => r.from === 'first-beat')
  const planned = [
    ...hotOf(plan).map((c) => ({ ms: c.ms, color: c.color, paired: c.place === 'both' })),
    ...hot
      .filter((h) => h.ms < START_MS && hotOf(plan).every((p) => !near(h.ms, p.ms)))
      .map((h) => ({
        ms: h.ms,
        color: start ? ruleColor(start, 1) : h.color,
        paired: start?.place === 'both',
      })),
  ].sort((a, b) => a.ms - b.ms)
  if (planned.length > MAX_HOT_CUES) return { status: 'too-many', needed: planned.length }

  const used = new Set<string>()
  const placed: WantedCue[] = []
  const drawn: DrawnHotCue[] = planned.map((w, i) => {
    const kind = HOT_KINDS[i]
    const there = hot.find((h) => !used.has(h.id) && near(h.ms, w.ms))
    if (there) used.add(there.id)
    placed.push(
      there
        ? { id: there.id, ms: there.ms, kind, color: w.color }
        : { ms: w.ms, kind, color: w.color },
    )
    if (
      w.paired &&
      !memory.some((m) => near(m.ms, w.ms)) &&
      ![...added, ...placed].some((c) => c.id === undefined && c.kind === 0 && near(c.ms, w.ms))
    )
      placed.push({ ms: w.ms, kind: 0, color: null })
    return { ms: there ? there.ms : w.ms, kind, color: w.color }
  })
  for (const h of hot) {
    if (used.has(h.id)) continue
    removed.add(h.id)
    const pairedMemory = memory.find(
      (m) => near(m.ms, h.ms) && !removed.has(m.id) && !wantedDrops.some((d) => near(d, m.ms)),
    )
    if (pairedMemory) removed.add(pairedMemory.id)
  }
  for (const c of plan.cues) {
    if (c.place !== 'call') continue
    const there = memory.find((m) => near(m.ms, c.ms))
    if (there) removed.delete(there.id)
    else if (![...added, ...placed].some((w) => w.kind === 0 && near(w.ms, c.ms)))
      placed.push({ ms: c.ms, kind: 0, color: null })
  }
  return {
    status: 'plan',
    wanted: [...memory.filter((m) => !removed.has(m.id)).map(keep), ...added, ...placed],
    hot: drawn,
    trimmed: plan.trimmed.map((c) => c.ms),
  }
}

export function diffCues(existing: ExistingCue[], wanted: WantedCue[]): CueChangeSet {
  const byId = new Map(existing.map((c) => [c.id, c]))
  const kept = new Set<string>()
  const changes: CueChangeSet = { insert: [], update: [], remove: [] }
  for (const w of wanted) {
    const was = w.id === undefined ? undefined : byId.get(w.id)
    if (!was) {
      changes.insert.push({ ms: w.ms, kind: w.kind, color: w.color })
      continue
    }
    kept.add(was.id)
    if (was.ms !== w.ms) changes.update.push({ id: was.id, kind: w.kind, color: w.color, ms: w.ms })
    else if (was.kind !== w.kind || was.color !== w.color)
      changes.update.push({ id: was.id, kind: w.kind, color: w.color })
  }
  changes.remove = existing.filter((c) => !kept.has(c.id)).map((c) => c.id)
  return changes
}

export function cueChanges(
  existing: ExistingCue[],
  drops: number[],
  previousDrops: number[],
  beats: number[],
  strong: StrongPart[],
): CueOutcome {
  const out = flowOutcome({
    existing,
    drops,
    previousDrops,
    beats,
    strong,
    phrases: [],
    flow: MY_FLOW,
  })
  if (out.status === 'too-many') return out
  const changes = diffCues(existing, out.wanted)
  return out.status === 'manual'
    ? { status: 'manual', changes }
    : { status: 'plan', changes, hot: out.hot }
}
