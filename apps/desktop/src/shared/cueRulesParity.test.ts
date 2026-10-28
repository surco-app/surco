import { describe, expect, it } from 'vitest'
import { MY_FLOW } from './cueFlows'
import {
  type CueOutcome,
  cueChanges,
  type ExistingCue,
  evaluateFlow,
  fitsPlan,
  HOT_KINDS,
  nearestBeat,
  type PlannedCue,
  planCues,
  type StrongPart,
} from './cueRules'

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
      if (strong.some((s) => s.start + SAME < beatsMs[back] && beatsMs[back] < s.end)) break
      plan.push({ ms: beatsMs[back], kind: bars })
      if (strong.some((s) => Math.abs(s.start - beatsMs[back]) <= SAME)) break
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

function spacedTrack(r: () => number) {
  const count = 1000 + Math.floor(r() * 800)
  const start = Math.floor(r() * 2000)
  const beatMs = 400 + r() * 200
  const beats = Array.from({ length: count }, (_, i) => Math.round(start + i * beatMs))
  const pick = (): number => beats[Math.floor(r() * count)]
  const drops: number[] = []
  const step = r() < 0.75 ? 48 : 20
  for (let at = 48 + Math.floor(r() * 32); at < count / 4; at += step + Math.floor(r() * 24))
    drops.push(beats[at * 4])
  const strong: StrongPart[] =
    r() < 0.8 ? [] : [{ start: beats[Math.floor(r() * count)], end: beats[count - 1] }]
  return { beats, drops, strong, pick }
}

function randomTrack(r: () => number) {
  if (r() < 0.2) return spacedTrack(r)
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

  const grid = (bars: number): number[] => Array.from({ length: bars * 4 }, (_, i) => i * 500)
  const beat = (bars: number): number => bars * 2000

  it('trims the 48 and then the earliest 32s to fit eight, as rules.py did', () => {
    const beats = grid(400)
    const drops = [48, 96, 144, 192, 240].map(beat)
    expect(planCues(drops, beats)).toEqual(legacyPlanCues(drops, beats))
    const out = evaluateFlow(MY_FLOW, { beats, drops, strong: [], phrases: [] })
    expect(out.cues).toHaveLength(8)
    expect(out.trimmed.map((c) => [c.ms, c.bars])).toEqual([
      [beat(0), 48],
      [beat(16), 32],
      [beat(64), 32],
    ])
  })

  it('still asks for more than eight when trimming cannot get there, as rules.py did', () => {
    const beats = grid(400)
    const drops = Array.from({ length: 10 }, (_, i) => beat(32 + 32 * i))
    expect(planCues(drops, beats)).toEqual(legacyPlanCues(drops, beats))
    expect(planCues(drops, beats)).toHaveLength(10)
    expect(cueChanges([], drops, [], beats, [])).toEqual(legacyCueChanges([], drops, [], beats, []))
    expect(cueChanges([], drops, [], beats, [])).toEqual({ status: 'too-many', needed: 10 })
  })
})

const LEGACY_COLOR: Record<16 | 32 | 48 | 'inicio', number> = { 16: 1, 32: 22, 48: 42, inicio: 32 }
const near = (a: number, b: number): boolean => Math.abs(a - b) <= SAME

function legacyCueChanges(
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
  const changes = {
    insert: wantedDrops
      .filter((ms) => !memory.some((m) => near(m.ms, ms)))
      .map((ms) => ({ ms, kind: 0, color: null as number | null })),
    update: [] as { id: string; kind: number; color: number }[],
    remove: currentDrops.filter((m) => !wantedDrops.some((d) => near(d, m.ms))).map((m) => m.id),
  }
  const plan = legacyPlanCues(wantedDrops, beats, strong)
  const oldPlan = legacyPlanCues(previousDrops, beats, strong)
  const fits = hot.every((h) => fitsPlan([h.ms], plan) || fitsPlan([h.ms], oldPlan))
  if (!fits) return { status: 'manual', changes }
  const wanted: PlannedCue[] = [
    ...plan,
    ...hot
      .filter((h) => h.ms < 3000 && plan.every((p) => !near(h.ms, p.ms)))
      .map((h) => ({ ms: h.ms, kind: 'inicio' as const })),
  ].sort((a, b) => a.ms - b.ms)
  if (wanted.length > 8) return { status: 'too-many', needed: wanted.length }
  const used = new Set<string>()
  const drawn = wanted.map((w, i) => {
    const kind = HOT_KINDS[i]
    const color = LEGACY_COLOR[w.kind]
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

function randomExisting(
  r: () => number,
  beats: number[],
  previousDrops: number[],
  strong: StrongPart[],
  pick: () => number,
): ExistingCue[] {
  const out: ExistingCue[] = []
  let n = 0
  const id = (): string => `e${n++}`
  if (r() < 0.7)
    legacyPlanCues(previousDrops, beats, strong).forEach((p, i) => {
      if (r() < 0.85)
        out.push({
          id: id(),
          ms: p.ms,
          kind: HOT_KINDS[i] ?? 9,
          color: r() < 0.9 ? LEGACY_COLOR[p.kind] : 1,
        })
      if (r() < 0.85) out.push({ id: id(), ms: p.ms, kind: 0, color: null })
    })
  for (const d of previousDrops)
    if (r() < 0.9) out.push({ id: id(), ms: d, kind: 0, color: r() < 0.9 ? null : 0 })
  if (r() < 0.2)
    out.push({
      id: id(),
      ms: pick(),
      kind: [1, 2, 3, 5][Math.floor(r() * 4)],
      color: r() < 0.5 ? null : 1,
    })
  if (r() < 0.2) out.push({ id: id(), ms: Math.floor(r() * 3000), kind: 1, color: 32 })
  if (out.length > 0 && r() < 0.1) out.push({ ...out[Math.floor(r() * out.length)], id: id() })
  return out
}

const removalsAsSet = (o: CueOutcome): CueOutcome =>
  o.status === 'too-many'
    ? o
    : { ...o, changes: { ...o.changes, remove: [...o.changes.remove].sort() } }

describe('Mi flujo through wanted sets against the frozen cueChanges', () => {
  it('changes exactly what cues.py completar changed in 3000 random collections', () => {
    const r = prng(19102026)
    for (let i = 0; i < 3000; i++) {
      const { beats, drops: previousDrops, strong, pick } = randomTrack(r)
      const existing = randomExisting(r, beats, previousDrops, strong, pick)
      const drops = [
        ...previousDrops.filter(() => r() < 0.7),
        ...Array.from({ length: Math.floor(r() * 3) }, pick),
      ]
      expect(
        removalsAsSet(cueChanges(existing, drops, previousDrops, beats, strong)),
        `case ${i}`,
      ).toEqual(removalsAsSet(legacyCueChanges(existing, drops, previousDrops, beats, strong)))
    }
  })
})
