import { type CueFlow, type CueRule, type FlowPhrase, RULE_BARS } from './cueFlows'
import {
  BAR_TOLERANCE,
  BEATS_PER_BAR,
  type CueChangeSet,
  diffCues,
  type ExistingCue,
  evaluateFlow,
  findDrops,
  flowOutcome,
  isEmptyChange,
  nearestBeat,
  SAME_POSITION_MS,
  START_MS,
  type StrongPart,
} from './cueRules'

export const DISTANCE_SUPPORT = 0.1
export const PATTERN_SHARE = 0.3
const MAJORITY = 0.5
const MAX_LEARNED_REPEAT = 8
const FALLBACK_COLOR = 22

export interface LearnCue {
  ms: number
  kind: number
  color: number | null
}

export interface LearnTrack {
  beats: number[]
  cues: LearnCue[]
  strong: StrongPart[]
  phrases: FlowPhrase[]
}

export interface LearnedFlow {
  flow: CueFlow
  coverage: { matching: number; marked: number }
}

export type MismatchReason =
  | 'too-many'
  | 'manual'
  | 'missing-hot-cue'
  | 'extra-hot-cue'
  | 'call-missing'
  | 'call-extra'
  | 'letter-order'
  | 'colour-null'
  | 'colour-differs'
  | 'start-cue-differs'
  | 'moved'
  | 'several-drops'
  | 'other'

export interface LearnDiagnosis {
  tracks: number
  noGrid: number
  noDrop: number
  marked: number
  support: Record<string, number>
  flow: CueFlow
  countdownPaired: number | null
  start: { open: number; withStart: number }
  matching: number
  mismatches: Partial<Record<MismatchReason, number[]>>
}

interface HotBefore {
  bars: number | null
  color: number | null
  paired: boolean
  firstBeat: boolean
}

interface Marked {
  index: number
  track: LearnTrack
  drops: number[]
  before: HotBefore[]
}

const near = (a: number, b: number): boolean => Math.abs(a - b) <= SAME_POSITION_MS

function markedOf(track: LearnTrack, index: number): Marked | null {
  if (track.beats.length === 0) return null
  const hot = track.cues.filter((c) => c.kind !== 0)
  const memory = track.cues.filter((c) => c.kind === 0)
  const drops = findDrops(
    memory.map((c) => c.ms),
    hot.map((c) => c.ms),
  )
  if (drops.length === 0) return null
  const dropAt = nearestBeat(track.beats, drops[0])
  const before = hot
    .filter((h) => h.ms < drops[0] - SAME_POSITION_MS)
    .map((h) => {
      const bars = (dropAt - nearestBeat(track.beats, h.ms)) / BEATS_PER_BAR
      const whole = Math.round(bars)
      return {
        bars: whole >= 1 && Math.abs(bars - whole) < BAR_TOLERANCE ? whole : null,
        color: h.color,
        paired: memory.some((m) => near(m.ms, h.ms)),
        firstBeat: near(h.ms, track.beats[0]),
      }
    })
  return { index, track, drops, before }
}

function dominantColor(colors: (number | null)[]): number {
  const counts = new Map<number, number>()
  for (const c of colors) if (c !== null && c >= 1) counts.set(c, (counts.get(c) ?? 0) + 1)
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])
  return ranked.length > 0 ? ranked[0][0] : FALLBACK_COLOR
}

const pairedShare = (cues: HotBefore[]): number | null =>
  cues.length === 0 ? null : cues.filter((c) => c.paired).length / cues.length

const placeOf = (cues: HotBefore[]): 'both' | 'hot' =>
  (pairedShare(cues) ?? 1) >= MAJORITY ? 'both' : 'hot'

function distanceSupport(tracks: Marked[]): Map<number, number> {
  const support = new Map<number, number>()
  for (const t of tracks)
    for (const d of new Set(
      t.before.flatMap((h) => (h.bars === null || h.firstBeat ? [] : [h.bars])),
    ))
      support.set(d, (support.get(d) ?? 0) + 1)
  return support
}

function learnedDistances(tracks: Marked[], support: Map<number, number>): number[] {
  const kept = [...support].filter(([, n]) => n >= DISTANCE_SUPPORT * tracks.length).map(([d]) => d)
  const step = Math.min(...kept.filter((d) => d > 0 && RULE_BARS.includes(d)))
  const out: number[] = []
  for (let k = 1; k <= MAX_LEARNED_REPEAT && kept.includes(k * step); k++) out.push(k * step)
  return out
}

function countdownCues(tracks: Marked[], distances: number[]): HotBefore[] {
  return tracks.flatMap((t) =>
    t.before.filter((h) => h.bars !== null && distances.includes(h.bars)),
  )
}

function countdownRule(tracks: Marked[], distances: number[]): CueRule | null {
  if (distances.length === 0) return null
  const cues = countdownCues(tracks, distances)
  const colors = distances.map((d) =>
    dominantColor(cues.filter((h) => h.bars === d).map((h) => h.color)),
  )
  return {
    from: 'drop',
    direction: 'back',
    bars: distances[0],
    repeat: distances.length,
    when: 'fits',
    place: placeOf(cues),
    color: colors.length === 1 ? { fixed: colors[0] } : { each: colors },
  }
}

function startCandidates(
  tracks: Marked[],
  countdown: CueRule | null,
  distances: number[],
): { open: Marked[]; starts: HotBefore[] } {
  const flow: CueFlow = { id: 'countdown', name: '', rules: countdown ? [countdown] : [] }
  const open = tracks.filter(
    (t) =>
      t.before.length > 0 &&
      !evaluateFlow(flow, { ...t.track, drops: t.drops }).cues.some((c) => c.ms < t.drops[0]),
  )
  const starts = open.flatMap((t) =>
    t.before
      .filter((h) => h.firstBeat && (h.bars === null || !distances.includes(h.bars)))
      .slice(0, 1),
  )
  return { open, starts }
}

function startRule(open: Marked[], starts: HotBefore[]): CueRule | null {
  if (open.length === 0 || starts.length < MAJORITY * open.length) return null
  return {
    from: 'first-beat',
    direction: 'back',
    bars: 0,
    repeat: 1,
    when: 'first',
    place: placeOf(starts),
    color: { fixed: dominantColor(starts.map((h) => h.color)) },
  }
}

function changeReasons(existing: ExistingCue[], changes: CueChangeSet): MismatchReason[] {
  const byId = new Map(existing.map((c) => [c.id, c]))
  const reasons: MismatchReason[] = []
  for (const c of changes.insert) reasons.push(c.kind === 0 ? 'call-missing' : 'missing-hot-cue')
  for (const id of changes.remove)
    reasons.push(byId.get(id)?.kind === 0 ? 'call-extra' : 'extra-hot-cue')
  for (const u of changes.update) {
    const was = byId.get(u.id)
    if (!was) reasons.push('other')
    else if (was.ms < START_MS) reasons.push('start-cue-differs')
    else if (u.ms !== undefined) reasons.push('moved')
    else if (was.kind !== u.kind) reasons.push('letter-order')
    else if (was.color === null || was.color < 1) reasons.push('colour-null')
    else reasons.push('colour-differs')
  }
  return reasons
}

function mismatchOf(flow: CueFlow, t: Marked): MismatchReason[] {
  const existing = t.track.cues.map((c, i) => ({ ...c, id: String(i) }))
  const out = flowOutcome({
    existing,
    drops: t.drops,
    previousDrops: t.drops,
    beats: t.track.beats,
    strong: t.track.strong,
    phrases: t.track.phrases,
    flow,
  })
  const changes = out.status === 'plan' ? diffCues(existing, out.wanted) : null
  if (changes && isEmptyChange(changes)) return []
  const reasons: MismatchReason[] = changes
    ? changeReasons(existing, changes)
    : [out.status === 'too-many' ? 'too-many' : 'manual']
  if (t.drops.length > 1) reasons.push('several-drops')
  return [...new Set(reasons.length > 0 ? reasons : ['other' as const])]
}

function learnMarked(marked: Marked[]) {
  const support = distanceSupport(marked)
  const distances = learnedDistances(marked, support)
  const countdown = countdownRule(marked, distances)
  const { open, starts } = startCandidates(marked, countdown, distances)
  const flow: CueFlow = {
    id: 'learned',
    name: '',
    rules: [countdown, startRule(open, starts)].filter((r): r is CueRule => r !== null),
  }
  const misses = marked.map((t) => ({ index: t.index, reasons: mismatchOf(flow, t) }))
  return { support, distances, flow, open, starts, misses }
}

export function learnFlow(tracks: LearnTrack[]): LearnedFlow | null {
  const marked = tracks.flatMap((t, i) => markedOf(t, i) ?? [])
  if (marked.length === 0) return null
  const { flow, misses } = learnMarked(marked)
  const matching = misses.filter((m) => m.reasons.length === 0).length
  if (matching < PATTERN_SHARE * marked.length) return null
  return { flow, coverage: { matching, marked: marked.length } }
}

export function diagnoseLearnFlow(tracks: LearnTrack[]): LearnDiagnosis {
  const marked = tracks.flatMap((t, i) => markedOf(t, i) ?? [])
  const noGrid = tracks.filter((t) => t.beats.length === 0).length
  const { support, distances, flow, open, starts, misses } = learnMarked(marked)
  const mismatches: Partial<Record<MismatchReason, number[]>> = {}
  for (const m of misses)
    for (const r of m.reasons) mismatches[r] = [...(mismatches[r] ?? []), m.index]
  return {
    tracks: tracks.length,
    noGrid,
    noDrop: tracks.length - noGrid - marked.length,
    marked: marked.length,
    support: Object.fromEntries([...support].sort((a, b) => b[1] - a[1])),
    flow,
    countdownPaired: pairedShare(countdownCues(marked, distances)),
    start: { open: open.length, withStart: starts.length },
    matching: misses.filter((m) => m.reasons.length === 0).length,
    mismatches,
  }
}
