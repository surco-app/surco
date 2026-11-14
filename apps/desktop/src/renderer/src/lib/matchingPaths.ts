import { matchingChains } from '../../../shared/matchingChains'
import type { SourcePlaylistEntry } from '../../../shared/types'
import type { MatchingPartner } from './matchingPartners'

const nfc = (path: string): string => path.normalize('NFC')
const key = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`)

export function unionPathPairs(
  surco: readonly (readonly [string, string])[],
  rekordbox: readonly (readonly [string, string])[],
  pathOfId: ReadonlyMap<string, string>,
): [string, string][] {
  const seen = new Set<string>()
  const out: [string, string][] = []
  const add = (a: string, b: string): void => {
    const [x, y] = [nfc(a), nfc(b)]
    if (x === y || seen.has(key(x, y))) return
    seen.add(key(x, y))
    out.push([x, y])
  }
  for (const [a, b] of surco) add(a, b)
  for (const [a, b] of rekordbox) {
    const [x, y] = [pathOfId.get(a), pathOfId.get(b)]
    if (x && y) add(x, y)
  }
  return out
}

const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path
const titleOf = (e: SourcePlaylistEntry): string =>
  e.preview?.title || (e.path ? fileName(e.path) : '')

function byPath(entries: readonly SourcePlaylistEntry[]): Map<string, SourcePlaylistEntry> {
  const map = new Map<string, SourcePlaylistEntry>()
  for (const e of entries) if (e.path && !e.separator) map.set(nfc(e.path), e)
  return map
}

export function matchingEntriesFor(
  entries: readonly SourcePlaylistEntry[],
  pairs: readonly (readonly [string, string])[],
): SourcePlaylistEntry[] {
  const here = byPath(entries)
  const held = pairs.filter(([a, b]) => here.has(nfc(a)) && here.has(nfc(b)))
  const chains = matchingChains(
    held.map(([a, b]) => [nfc(a), nfc(b)] as const),
    (path) => titleOf(here.get(path) as SourcePlaylistEntry),
  )
  return chains.flatMap((chain, i) => [
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
    ...chain.map((path) => here.get(path) as SourcePlaylistEntry),
  ])
}

export function pathPartners(
  pairs: readonly (readonly [string, string])[],
  path: string,
  entries: readonly SourcePlaylistEntry[],
): MatchingPartner[] {
  const self = nfc(path)
  const here = byPath(entries)
  const others = new Set(
    pairs.flatMap(([a, b]) => {
      const [x, y] = [nfc(a), nfc(b)]
      return x === self ? [y] : y === self ? [x] : []
    }),
  )
  return [...others].flatMap((p) => {
    const e = here.get(p)
    if (!e) return []
    return [
      {
        contentId: p,
        path: p,
        title: titleOf(e),
        artist: e.preview?.artist ?? '',
        key: e.meta.key ?? '',
      },
    ]
  })
}
