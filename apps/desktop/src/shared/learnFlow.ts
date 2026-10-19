import { type CueFlow, type CueRule, type FlowPhrase, MY_FLOW, RULE_BARS } from './cueFlows'
import {
  BAR_TOLERANCE,
  BEATS_PER_BAR,
  evaluateFlow,
  findDrops,
  flowOutcome,
  nearestBeat,
  SAME_POSITION_MS,
  START_MS,
  type StrongPart,
} from './cueRules'

export const DISTANCE_SUPPORT = 0.2
export const MIN_SUPPORT_SHARE = 0.02
const MIN_SUPPORT_TRACKS = 2
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
  | 'missing-hot-cue'
  | 'call-missing'
  | 'colour-null'
  | 'colour-differs'
  | 'start-cue-differs'
  | 'moved'
  | 'several-drops'

export interface LearnDiagnosis {
  tracks: number
  noGrid: number
  noDrop: number
  marked: number
  support: Record<string, Support>
  flow: CueFlow
  countdownPaired: number | null
  start: { open: number; withStart: number }
  matching: number
  mismatches: Partial<Record<MismatchReason, number[]>>
  withExtraHot: number
  withExtraCall: number
  myFlow: Coverage
}

export interface Coverage {
  matching: number
  mismatches: Partial<Record<MismatchReason, number[]>>
  withExtraHot: number
  withExtraCall: number
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
  dropBeat: number
  before: HotBefore[]
}

interface Support {
  tracks: number
  eligible: number
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
  return { index, track, drops, dropBeat: dropAt, before }
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

function distanceSupport(tracks: Marked[]): Map<number, Support> {
  const counts = new Map<number, number>()
  for (const t of tracks)
    for (const d of new Set(
      t.before.flatMap((h) => (h.bars === null || h.firstBeat ? [] : [h.bars])),
    ))
      counts.set(d, (counts.get(d) ?? 0) + 1)
  return new Map(
    [...counts]
      .sort((a, b) => a[0] - b[0])
      .map(([d, n]) => [
        d,
        { tracks: n, eligible: tracks.filter((t) => t.dropBeat > d * BEATS_PER_BAR).length },
      ]),
  )
}

function learnedDistances(tracks: Marked[], support: Map<number, Support>): number[] {
  const least = Math.max(MIN_SUPPORT_TRACKS, Math.ceil(MIN_SUPPORT_SHARE * tracks.length))
  const kept = [...support]
    .filter(([, s]) => s.tracks >= least && s.tracks >= DISTANCE_SUPPORT * s.eligible)
    .map(([d]) => d)
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

interface Placed {
  ms: number
  hot: boolean
  color: number | null
}

const placedOf = (c: LearnCue): Placed => ({ ms: c.ms, hot: c.kind !== 0, color: c.color })

function compareCues(
  beats: number[],
  wanted: Placed[],
  actual: Placed[],
): { reasons: MismatchReason[]; extra: Placed[] } {
  const reasons: MismatchReason[] = []
  const left = [...actual]
  const missed: Placed[] = []
  const hotReason = (c: Placed, reason: MismatchReason): MismatchReason =>
    c.hot && c.ms < START_MS ? 'start-cue-differs' : reason
  for (const w of wanted) {
    const i = left.findIndex((a) => a.hot === w.hot && near(a.ms, w.ms))
    if (i < 0) {
      missed.push(w)
      continue
    }
    const [a] = left.splice(i, 1)
    if (w.hot && a.color !== w.color)
      reasons.push(hotReason(a, a.color === null || a.color < 1 ? 'colour-null' : 'colour-differs'))
  }
  for (const w of missed) {
    const at = nearestBeat(beats, w.ms)
    const i = left.findIndex(
      (a) => a.hot === w.hot && Math.abs(nearestBeat(beats, a.ms) - at) <= BEATS_PER_BAR,
    )
    if (i >= 0) {
      left.splice(i, 1)
      reasons.push(hotReason(w, 'moved'))
    } else reasons.push(w.hot ? hotReason(w, 'missing-hot-cue') : 'call-missing')
  }
  return { reasons, extra: left }
}

function mismatchOf(flow: CueFlow, t: Marked): { reasons: MismatchReason[]; extra: Placed[] } {
  const out = flowOutcome({
    existing: [],
    drops: t.drops,
    previousDrops: [],
    beats: t.track.beats,
    strong: t.track.strong,
    phrases: t.track.phrases,
    flow,
  })
  const { reasons, extra } =
    out.status === 'too-many'
      ? { reasons: ['too-many' as const], extra: [] }
      : compareCues(t.track.beats, out.wanted.map(placedOf), t.track.cues.map(placedOf))
  if (reasons.length > 0 && t.drops.length > 1) reasons.push('several-drops')
  return { reasons: [...new Set(reasons)], extra }
}

function mismatchesOf(marked: Marked[], flow: CueFlow): Coverage {
  const out: Coverage = { matching: 0, mismatches: {}, withExtraHot: 0, withExtraCall: 0 }
  for (const t of marked) {
    const { reasons, extra } = mismatchOf(flow, t)
    if (reasons.length === 0) out.matching++
    if (extra.some((c) => c.hot)) out.withExtraHot++
    if (extra.some((c) => !c.hot)) out.withExtraCall++
    for (const r of reasons) out.mismatches[r] = [...(out.mismatches[r] ?? []), t.index]
  }
  return out
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
  return { support, distances, flow, open, starts }
}

export function learnFlow(tracks: LearnTrack[]): LearnedFlow | null {
  const marked = tracks.flatMap((t, i) => markedOf(t, i) ?? [])
  if (marked.length === 0) return null
  const { flow } = learnMarked(marked)
  if (flow.rules.length === 0) return null
  const { matching } = mismatchesOf(marked, flow)
  if (matching < PATTERN_SHARE * marked.length) return null
  return { flow, coverage: { matching, marked: marked.length } }
}

export function diagnoseLearnFlow(tracks: LearnTrack[]): LearnDiagnosis {
  const marked = tracks.flatMap((t, i) => markedOf(t, i) ?? [])
  const noGrid = tracks.filter((t) => t.beats.length === 0).length
  const { support, distances, flow, open, starts } = learnMarked(marked)
  const learned = mismatchesOf(marked, flow)
  return {
    tracks: tracks.length,
    noGrid,
    noDrop: tracks.length - noGrid - marked.length,
    marked: marked.length,
    support: Object.fromEntries(support),
    flow,
    countdownPaired: pairedShare(countdownCues(marked, distances)),
    start: { open: open.length, withStart: starts.length },
    matching: learned.matching,
    mismatches: learned.mismatches,
    withExtraHot: learned.withExtraHot,
    withExtraCall: learned.withExtraCall,
    myFlow: mismatchesOf(marked, MY_FLOW),
  }
}
