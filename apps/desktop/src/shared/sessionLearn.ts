import { camelotDistance } from './camelot'
import type { SessionTrack } from './sessionTypes'

export interface LearnedMixing {
  tempoTight?: number
  tempoWide?: number
  keyCare?: number
}

const MIN_TRANSITIONS = 30
const TIGHT_SHARE = 0.5
const WIDE_SHARE = 0.8
const TIGHT_RANGE = [1, 8] as const
const WIDE_MAX = 16
const HARMONIC_DJ = 0.7

function share(sorted: readonly number[], at: number): number {
  return sorted[Math.round(at * (sorted.length - 1))]
}

function chanceOfHarmony(keys: readonly string[]): number {
  const counts = new Map<string, number>()
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
  let near = 0
  for (const [a, x] of counts)
    for (const [b, y] of counts) if ((camelotDistance(a, b) ?? 99) <= 1) near += x * y
  return near / keys.length ** 2
}

export function learnMixing(
  sequences: readonly (readonly string[])[],
  pool: ReadonlyMap<string, SessionTrack>,
): LearnedMixing {
  const jumps: number[] = []
  const keys: string[] = []
  let keyed = 0
  let harmonic = 0
  for (const sequence of sequences) {
    for (let i = 1; i < sequence.length; i++) {
      const from = pool.get(sequence[i - 1])
      const to = pool.get(sequence[i])
      if (!from || !to) continue
      if (from.bpm > 0 && to.bpm > 0) jumps.push(Math.abs(from.bpm - to.bpm))
      const distance = camelotDistance(from.key, to.key)
      if (distance === null) continue
      keyed++
      if (distance <= 1) harmonic++
      keys.push(to.key as string)
    }
  }
  const learned: LearnedMixing = {}
  if (jumps.length >= MIN_TRANSITIONS) {
    jumps.sort((a, b) => a - b)
    const tight = Math.min(TIGHT_RANGE[1], Math.max(TIGHT_RANGE[0], share(jumps, TIGHT_SHARE)))
    learned.tempoTight = tight
    learned.tempoWide = Math.min(WIDE_MAX, Math.max(tight + 1, share(jumps, WIDE_SHARE)))
  }
  if (keyed >= MIN_TRANSITIONS) {
    const chance = chanceOfHarmony(keys)
    const care = (harmonic / keyed - chance) / (HARMONIC_DJ - chance)
    learned.keyCare = Math.min(1, Math.max(0, care))
  }
  return learned
}
