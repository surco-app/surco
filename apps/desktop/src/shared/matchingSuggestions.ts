export const MIN_TIMES_TOGETHER = 3

export interface PairSuggestion {
  pair: [string, string]
  times: number
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export function suggestPairs(
  sequences: readonly (readonly string[])[],
  matched: readonly (readonly [string, string])[],
  dismissed: ReadonlySet<string>,
  minTimes = MIN_TIMES_TOGETHER,
): PairSuggestion[] {
  const taken = new Set(matched.map(([a, b]) => pairKey(a, b)))
  const counted = new Map<string, PairSuggestion & { lead: number }>()
  for (const sequence of sequences) {
    const seen = new Set<string>()
    for (let i = 0; i + 1 < sequence.length; i++) {
      const a = sequence[i]
      const b = sequence[i + 1]
      if (a === b) continue
      const key = pairKey(a, b)
      if (seen.has(key) || taken.has(key) || dismissed.has(key)) continue
      seen.add(key)
      const found = counted.get(key)
      if (!found) {
        counted.set(key, { pair: [a, b], times: 1, lead: 1 })
        continue
      }
      found.times += 1
      found.lead += found.pair[0] === a ? 1 : -1
      if (found.lead < 0) {
        found.pair = [a, b]
        found.lead = 1
      }
    }
  }
  return [...counted.values()]
    .filter((s) => s.times >= minTimes)
    .map(({ pair, times }) => ({ pair, times }))
    .sort((x, y) => y.times - x.times || pairKey(...x.pair).localeCompare(pairKey(...y.pair)))
}

export function normalizeMatchingDismissed(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(value.filter((v): v is string => typeof v === 'string' && /^[^|]+\|[^|]+$/.test(v))),
  ]
}
