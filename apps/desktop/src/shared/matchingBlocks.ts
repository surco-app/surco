import type { SourcePlaylistEntry } from './types'

export function matchingBlocks(
  pairs: readonly (readonly [string, string])[],
  label: (id: string) => string,
): string[][] {
  const followers = new Map<string, string[]>()
  const seen = new Set<string>()
  for (const [a, b] of pairs) {
    if (a === b || seen.has(`${a}\0${b}`) || seen.has(`${b}\0${a}`)) continue
    seen.add(`${a}\0${b}`)
    followers.set(a, [...(followers.get(a) ?? []), b])
  }
  const blocks = [...followers].map(([head, rest]) => [head, ...rest])
  return blocks.sort((x, y) => y.length - x.length || label(x[0]).localeCompare(label(y[0])))
}

export function pairsOfBlocks(
  pairs: readonly (readonly [string, string])[],
  chosen: readonly string[],
): [string, string][] {
  const picked = new Set(chosen)
  const heads = new Set(chosen)
  for (const [a, b] of pairs) if (a !== b && picked.has(b)) heads.add(a)
  const seen = new Set<string>()
  return pairs.flatMap(([a, b]) => {
    const key = `${a}\0${b}`
    if (a === b || !heads.has(a) || seen.has(key)) return []
    seen.add(key)
    return [[a, b] as [string, string]]
  })
}

export function withBlockSeparators(
  blocks: readonly (readonly SourcePlaylistEntry[])[],
): SourcePlaylistEntry[] {
  return blocks.flatMap((block, i) => [
    ...(i > 0
      ? [
          {
            path: null,
            separator: true,
            meta: {},
            linkId: `matching-sep-${i}`,
          } satisfies SourcePlaylistEntry,
        ]
      : []),
    ...block,
  ])
}
