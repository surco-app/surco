import { type CueFlow, type CueRule, type FlowPhrase, RULE_BARS } from './cueFlows'
import {
  BAR_TOLERANCE,
  BEATS_PER_BAR,
  diffCues,
  evaluateFlow,
  findDrops,
  flowOutcome,
  isEmptyChange,
  nearestBeat,
  SAME_POSITION_MS,
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

interface HotBefore {
  bars: number | null
  color: number | null
  paired: boolean
  firstBeat: boolean
}

interface Marked {
  track: LearnTrack
  drops: number[]
  before: HotBefore[]
}

const near = (a: number, b: number): boolean => Math.abs(a - b) <= SAME_POSITION_MS

function markedOf(track: LearnTrack): Marked | null {
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
  return { track, drops, before }
}

function dominantColor(colors: (number | null)[]): number {
  const counts = new Map<number, number>()
  for (const c of colors) if (c !== null && c >= 1) counts.set(c, (counts.get(c) ?? 0) + 1)
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])
  return ranked.length > 0 ? ranked[0][0] : FALLBACK_COLOR
}

const mostlyPaired = (cues: HotBefore[]): boolean =>
  cues.filter((c) => c.paired).length >= MAJORITY * cues.length

function learnedDistances(tracks: Marked[]): number[] {
  const support = new Map<number, number>()
  for (const t of tracks)
    for (const d of new Set(
      t.before.flatMap((h) => (h.bars === null || h.firstBeat ? [] : [h.bars])),
    ))
      support.set(d, (support.get(d) ?? 0) + 1)
  const kept = [...support].filter(([, n]) => n >= DISTANCE_SUPPORT * tracks.length).map(([d]) => d)
  const step = Math.min(...kept.filter((d) => d > 0 && RULE_BARS.includes(d)))
  const out: number[] = []
  for (let k = 1; k <= MAX_LEARNED_REPEAT && kept.includes(k * step); k++) out.push(k * step)
  return out
}

function countdownRule(tracks: Marked[], distances: number[]): CueRule | null {
  if (distances.length === 0) return null
  const cues = tracks.flatMap((t) =>
    t.before.filter((h) => h.bars !== null && distances.includes(h.bars)),
  )
  const colors = distances.map((d) =>
    dominantColor(cues.filter((h) => h.bars === d).map((h) => h.color)),
  )
  return {
    from: 'drop',
    direction: 'back',
    bars: distances[0],
    repeat: distances.length,
    when: 'fits',
    place: mostlyPaired(cues) ? 'both' : 'hot',
    color: colors.length === 1 ? { fixed: colors[0] } : { each: colors },
  }
}

function startRule(
  tracks: Marked[],
  countdown: CueRule | null,
  distances: number[],
): CueRule | null {
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
  if (open.length === 0 || starts.length < MAJORITY * open.length) return null
  return {
    from: 'first-beat',
    direction: 'back',
    bars: 0,
    repeat: 1,
    when: 'first',
    place: mostlyPaired(starts) ? 'both' : 'hot',
    color: { fixed: dominantColor(starts.map((h) => h.color)) },
  }
}

function reproduces(flow: CueFlow, t: Marked): boolean {
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
  return out.status === 'plan' && isEmptyChange(diffCues(existing, out.wanted))
}

export function learnFlow(tracks: LearnTrack[]): LearnedFlow | null {
  const marked = tracks.flatMap((t) => markedOf(t) ?? [])
  if (marked.length === 0) return null
  const distances = learnedDistances(marked)
  const countdown = countdownRule(marked, distances)
  const start = startRule(marked, countdown, distances)
  const flow: CueFlow = {
    id: 'learned',
    name: '',
    rules: [countdown, start].filter((r): r is CueRule => r !== null),
  }
  const matching = marked.filter((t) => reproduces(flow, t)).length
  if (matching < PATTERN_SHARE * marked.length) return null
  return { flow, coverage: { matching, marked: marked.length } }
}
