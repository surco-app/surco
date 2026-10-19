import type { CueFlow, FlowPhrase, PhraseKind } from '../../../shared/cueFlows'
import { type FlowOutcome, flowOutcome, type StrongPart } from '../../../shared/cueRules'
import type { CueWaveColumn } from '../../../shared/types'

const BEAT_MS = 60000 / 128
const BARS = 192

export const EXAMPLE_GRID = Array.from({ length: BARS * 4 }, (_, i) => ({
  ms: Math.round(i * BEAT_MS),
  beat: (i % 4) + 1,
}))

export const exampleBar = (n: number): number => EXAMPLE_GRID[n * 4].ms
export const EXAMPLE_DROP = exampleBar(64)
export const EXAMPLE_DURATION_MS = Math.round(BARS * 4 * BEAT_MS)

const SECTIONS: [number, PhraseKind][] = [
  [0, 'intro'],
  [32, 'up'],
  [64, 'chorus'],
  [96, 'down'],
  [112, 'up'],
  [128, 'chorus'],
  [160, 'outro'],
]

export const EXAMPLE_PHRASES: FlowPhrase[] = SECTIONS.map(([bar, kind]) => ({
  ms: exampleBar(bar),
  kind,
}))

export const EXAMPLE_STRONG: StrongPart[] = [
  { start: exampleBar(64), end: exampleBar(96) },
  { start: exampleBar(128), end: exampleBar(160) },
]

const LEVEL: Record<PhraseKind, number> = {
  intro: 0.35,
  up: 0.55,
  chorus: 0.95,
  down: 0.45,
  outro: 0.3,
}

export const EXAMPLE_WAVE: CueWaveColumn[] = Array.from({ length: BARS }, (_, bar) => {
  const kind = [...SECTIONS].reverse().find(([start]) => start <= bar)?.[1] ?? 'intro'
  return { h: LEVEL[kind] * (bar % 4 === 0 ? 1 : 0.85), rgb: null }
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
  })
}
