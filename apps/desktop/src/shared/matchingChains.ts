export function matchingChains(
  pairs: readonly (readonly [string, string])[],
  label: (id: string) => string,
): string[][] {
  const partners = new Map<string, Set<string>>()
  const link = (from: string, to: string): void => {
    const set = partners.get(from) ?? new Set<string>()
    set.add(to)
    partners.set(from, set)
  }
  for (const [a, b] of pairs) {
    if (a === b) continue
    link(a, b)
    link(b, a)
  }

  const byLabel = (x: string, y: string): number => label(x).localeCompare(label(y))
  const startOrder = [...partners.keys()].sort(
    (x, y) => (partners.get(x)?.size ?? 0) - (partners.get(y)?.size ?? 0) || byLabel(x, y),
  )

  const seen = new Set<string>()
  const chains: string[][] = []
  for (const start of startOrder) {
    if (seen.has(start)) continue
    const chain: string[] = []
    const queue = [start]
    seen.add(start)
    while (queue.length > 0) {
      const id = queue.shift() as string
      chain.push(id)
      for (const next of [...(partners.get(id) ?? [])].sort(byLabel)) {
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
    chains.push(chain)
  }
  return chains.sort((x, y) => y.length - x.length || byLabel(x[0], y[0]))
}
