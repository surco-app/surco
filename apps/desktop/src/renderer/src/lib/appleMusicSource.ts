import type {
  AppleMusicPlaylist,
  AppleMusicPlaylistTracks,
  SourceNode,
  SourcePlaylistEntry,
} from '../../../shared/types'

// Music's playlists in the shape every source shares. Music only reports the folder a
// playlist sits in, not the whole path, so the tree is one level deep; root playlists
// come first, as the old import dialog showed them, so none reads as belonging to the
// folder above it.
export function musicTree(lists: AppleMusicPlaylist[]): SourceNode[] {
  const root: SourceNode[] = []
  const folders = new Map<string, SourceNode[]>()
  for (const p of lists) {
    const node: SourceNode = { id: p.persistentId, name: p.name, kind: 'playlist', count: p.count }
    if (!p.folder) {
      root.push(node)
      continue
    }
    const children = folders.get(p.folder) ?? []
    children.push(node)
    folders.set(p.folder, children)
  }
  const grouped = [...folders].map(
    ([name, children]): SourceNode => ({
      id: `folder:${name}`,
      name,
      kind: 'folder',
      count: children.length,
      children,
    }),
  )
  return [...root, ...grouped]
}

// Music counts a playlist's rows, repeats included, while the list shows each file once. A
// playlist already read is counted the list's way instead: each file once, and each
// file-less row (the open notice names those, as rekordbox's count keeps streaming rows).
export function distinctTracks(entries: SourcePlaylistEntry[]): number {
  const files = new Set(entries.flatMap((e) => (e.path ? [e.path.normalize('NFC')] : [])))
  return files.size + entries.filter((e) => !e.path).length
}

export function withReadCounts(
  nodes: SourceNode[],
  countOf: (id: string) => number | undefined,
): SourceNode[] {
  return nodes.map((n) =>
    n.children
      ? { ...n, children: withReadCounts(n.children, countOf) }
      : { ...n, count: countOf(n.id) ?? n.count },
  )
}

// Music returns the files and, apart, how many rows had none; the shared shape keeps those
// as file-less entries so the app can tell the user how many have no file. Music has no
// separators.
export function joinStretches(
  a: AppleMusicPlaylistTracks,
  b: AppleMusicPlaylistTracks,
): AppleMusicPlaylistTracks {
  const had = new Set(a.paths)
  const fresh = b.paths.filter((p) => !had.has(p))
  return {
    paths: [...a.paths, ...fresh],
    persistentIds: { ...b.persistentIds, ...a.persistentIds },
    meta: { ...b.meta, ...a.meta },
    missing: a.missing + b.missing,
    ...(b.total !== undefined
      ? { total: b.total }
      : a.total !== undefined
        ? { total: a.total }
        : {}),
  }
}

export function musicEntries(t: AppleMusicPlaylistTracks): SourcePlaylistEntry[] {
  const rows: SourcePlaylistEntry[] = t.paths.map((path) => ({
    path,
    separator: false,
    meta: t.meta[path] ?? {},
    ...(t.persistentIds[path] ? { musicPersistentId: t.persistentIds[path] } : {}),
  }))
  for (let i = 0; i < t.missing; i++) rows.push({ path: null, separator: false, meta: {} })
  return rows
}
