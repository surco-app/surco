import type { CueFlow, FlowPhrase, PhraseKind } from '../../../shared/cueFlows'
import { type FlowOutcome, flowOutcome, type StrongPart } from '../../../shared/cueRules'
import type { CueWaveColumn } from '../../../shared/types'

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
