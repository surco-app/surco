import type { CueFlow, FlowPhrase, PhraseKind } from '../../../shared/cueFlows'
import {
  type FlowOutcome,
  type FlowTrack,
  findDrops,
  flowOutcome,
  SAME_POSITION_MS,
  type StrongPart,
} from '../../../shared/cueRules'
import { type LearnTrack, learnFlowFromTrack } from '../../../shared/learnFlow'
import type { CueWaveColumn, TrackCues } from '../../../shared/types'
import type { TrackItem } from '../types'

const BEAT_MS = 60000 / 128
const BARS = 192

export const EXAMPLE_GRID = Array.from({ length: BARS * 4 }, (_, i) => ({
  ms: Math.round(i * BEAT_MS),
  beat: (i % 4) + 1,
}))

export const exampleBar = (n: number): number => EXAMPLE_GRID[(n - 1) * 4].ms
export const EXAMPLE_POINT_BAR = 96
export const EXAMPLE_DROP = exampleBar(EXAMPLE_POINT_BAR)
export const EXAMPLE_DURATION_MS = Math.round(BARS * 4 * BEAT_MS)

const SECTIONS: [number, PhraseKind][] = [
  [1, 'intro'],
  [48, 'up'],
  [96, 'chorus'],
  [128, 'down'],
  [144, 'up'],
  [160, 'chorus'],
  [176, 'outro'],
]

export const EXAMPLE_PHRASES: FlowPhrase[] = SECTIONS.map(([bar, kind]) => ({
  ms: exampleBar(bar),
  kind,
}))

export const EXAMPLE_STRONG: StrongPart[] = [
  { start: exampleBar(96), end: exampleBar(128) },
  { start: exampleBar(160), end: exampleBar(176) },
]

const WAVE_LEVELS: [number, number][] = [
  [1, 0.35],
  [48, 0.6],
  [80, 0.2],
  [96, 0.95],
  [128, 0.6],
  [176, 0.3],
]

export const EXAMPLE_WAVE: CueWaveColumn[] = Array.from({ length: BARS }, (_, bar) => {
  const level = [...WAVE_LEVELS].reverse().find(([start]) => start <= bar + 1)?.[1] ?? 0.35
  return { h: level * (bar % 4 === 0 ? 1 : 0.85), rgb: null }
})

export const EXAMPLE_TRACK: FlowTrack = {
  beats: EXAMPLE_GRID.map((b) => b.ms),
  drops: [EXAMPLE_DROP],
  strong: EXAMPLE_STRONG,
  phrases: EXAMPLE_PHRASES,
}

export function examplePlan(flow: CueFlow): FlowOutcome {
  return flowOutcome({
    existing: [],
    drops: [EXAMPLE_DROP],
    previousDrops: [],
    beats: EXAMPLE_GRID.map((b) => b.ms),
    strong: EXAMPLE_STRONG,
    phrases: EXAMPLE_PHRASES,
    flow,
    point: EXAMPLE_DROP,
  })
}

export function trackOfCues(read: TrackCues): FlowTrack {
  const live = read.cues.filter((c) => !c.loop)
  return {
    beats: read.grid.map((b) => b.ms),
    drops: findDrops(
      live.filter((c) => c.kind === 0).map((c) => c.ms),
      live.filter((c) => c.kind !== 0).map((c) => c.ms),
    ),
    strong: read.strong,
    phrases: read.phrases,
  }
}

export function learnTrackOf(read: TrackCues): LearnTrack {
  return {
    beats: read.grid.map((b) => b.ms),
    cues: read.cues.filter((c) => !c.loop).map(({ ms, kind, color }) => ({ ms, kind, color })),
    strong: read.strong,
    phrases: read.phrases,
  }
}

export function flowFromTrack(read: TrackCues): CueFlow | null {
  return learnFlowFromTrack(learnTrackOf(read))
}

export function previewChoices(
  tracks: Pick<TrackItem, 'id' | 'listLabel' | 'sourcePreview'>[],
  contentOf: ReadonlyMap<string, string>,
): { contentId: string; label: string }[] {
  const seen = new Set<string>()
  return tracks.flatMap((t) => {
    const contentId = contentOf.get(t.id)
    const cues = t.sourcePreview?.cues ?? []
    const marks = findDrops(
      cues.filter((c) => c.kind === 0).map((c) => c.ms),
      cues.filter((c) => c.kind !== 0).map((c) => c.ms),
    )
    if (!contentId || marks.length === 0 || seen.has(contentId)) return []
    seen.add(contentId)
    return [{ contentId, label: t.listLabel }]
  })
}

export function trackPlan(flow: CueFlow, track: FlowTrack): FlowOutcome {
  return flowOutcome({
    existing: track.drops.map((ms, i) => ({ id: `mark-${i}`, ms, kind: 0, color: null })),
    drops: track.drops,
    previousDrops: [],
    beats: track.beats,
    strong: track.strong,
    phrases: track.phrases,
    flow,
  })
}

export const samePosition = (a: number, b: number): boolean => Math.abs(a - b) <= SAME_POSITION_MS

export function hotDiff(
  planned: number[],
  existing: number[],
): { added: number[]; gone: number[] } {
  return {
    added: planned.filter((p) => !existing.some((e) => samePosition(p, e))),
    gone: existing
      .filter((e) => !planned.some((p) => samePosition(p, e)))
      .filter((e, i, all) => all.findIndex((o) => samePosition(o, e)) === i),
  }
}

export function differingHot(planned: number[], existing: number[]): number {
  const { added, gone } = hotDiff(planned, existing)
  return added.length + gone.length
}
