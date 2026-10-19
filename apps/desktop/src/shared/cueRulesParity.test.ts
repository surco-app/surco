import { describe, expect, it } from 'vitest'
import { nearestBeat, type PlannedCue, planCues, type StrongPart } from './cueRules'

const SAME = 50
const LEGACY_DISTANCES = [16, 32, 48] as const
const LEGACY_TRIM = [48, 32] as const

function legacyPlanCues(
  dropsMs: number[],
  beatsMs: number[],
  strong: StrongPart[] = [],
): PlannedCue[] {
  let plan: PlannedCue[] = []
  let previous: number | null = null
  for (const drop of [...dropsMs].sort((a, b) => a - b)) {
    const index = nearestBeat(beatsMs, drop)
    for (const bars of LEGACY_DISTANCES) {
      const back = index - bars * 4
      if (back < 0 || (previous !== null && beatsMs[back] <= previous + SAME)) break
      if (strong.some((s) => s.start <= beatsMs[back] && beatsMs[back] < s.end)) break
      plan.push({ ms: beatsMs[back], kind: bars })
    }
    previous = drop
  }
  const firstDrop = dropsMs.length > 0 ? Math.min(...dropsMs) : null
  if (firstDrop !== null && !plan.some((p) => p.ms < firstDrop) && beatsMs[0] < firstDrop - SAME)
    plan.push({ ms: beatsMs[0], kind: 'inicio' })
  for (const kind of LEGACY_TRIM) {
    while (plan.length > 8 && plan.some((p) => p.kind === kind)) {
      const earliest = plan.filter((p) => p.kind === kind).reduce((a, b) => (b.ms < a.ms ? b : a))
      plan = plan.filter((p) => p !== earliest)
    }
  }
  return plan.sort((a, b) => a.ms - b.ms)
}

function prng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomTrack(r: () => number) {
  const count = 100 + Math.floor(r() * 700)
  const start = Math.floor(r() * 2000)
  const beatMs = 400 + r() * 200
  const change = Math.floor(r() * count)
  const beats = Array.from({ length: count }, (_, i) =>
    Math.round(start + i * beatMs + (i > change ? (i - change) * 20 : 0)),
  )
  const end = beats[count - 1]
  const pick = (): number =>
    r() < 0.8 ? beats[Math.floor(r() * count)] : Math.round(r() * (end + 2000))
  const drops = Array.from({ length: Math.floor(r() * 6) }, pick)
  if (drops.length > 0 && r() < 0.1) drops.push(drops[0])
  const strong: StrongPart[] =
    r() < 0.5
      ? []
      : Array.from({ length: 1 + Math.floor(r() * 3) }, () => {
          const a = Math.floor(r() * count)
          return { start: beats[a], end: beats[Math.min(count - 1, a + Math.floor(r() * 128))] }
        })
  return { beats, drops, strong, pick }
}

describe('Mi flujo through the engine against the frozen planCues', () => {
  it('plans exactly what rules.py planned in 3000 random tracks', () => {
    const r = prng(20261019)
    for (let i = 0; i < 3000; i++) {
      const { beats, drops, strong } = randomTrack(r)
      expect(planCues(drops, beats, strong), `case ${i}`).toEqual(
        legacyPlanCues(drops, beats, strong),
      )
    }
  })
})
