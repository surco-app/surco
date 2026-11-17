export type Item = string | { text: string; in: string }

export type Patch = { version: string; items: Item[] }

const patchNumber = (version: string) => Number(version.split('.')[2])

export function splitByPatch(items: Item[]): { base: Item[]; patches: Patch[] } {
  const base: Item[] = []
  const byVersion = new Map<string, Item[]>()
  for (const item of items) {
    if (typeof item === 'string' || patchNumber(item.in) === 0) {
      base.push(item)
      continue
    }
    byVersion.set(item.in, [...(byVersion.get(item.in) ?? []), item])
  }
  const patches = [...byVersion]
    .map(([version, patchItems]) => ({ version, items: patchItems }))
    .sort((a, b) => patchNumber(a.version) - patchNumber(b.version))
  return { base, patches }
}
