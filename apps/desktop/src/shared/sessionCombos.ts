export type Combos = ReadonlyMap<string, ReadonlyMap<string, number>>

export function mineCombos(
  sets: readonly (readonly string[])[],
  pool: ReadonlySet<string>,
  minSets = 1,
): Combos {
  const counted = new Map<string, Map<string, number>>()
  for (const set of sets) {
    const seen = new Set<string>()
    for (let i = 0; i + 1 < set.length; i++) {
      const from = set[i]
      const to = set[i + 1]
      if (from === to || !pool.has(from) || !pool.has(to)) continue
      const pair = `${from}\u0000${to}`
      if (seen.has(pair)) continue
      seen.add(pair)
      const next = counted.get(from) ?? new Map<string, number>()
      next.set(to, (next.get(to) ?? 0) + 1)
      counted.set(from, next)
    }
  }
  const combos = new Map<string, Map<string, number>>()
  for (const [from, targets] of counted) {
    const kept = new Map([...targets].filter(([, strength]) => strength >= minSets))
    if (kept.size > 0) combos.set(from, kept)
  }
  return combos
}
