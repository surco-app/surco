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

// Music returns the files and, apart, how many rows had none; the shared shape keeps those
// as file-less entries so the app can tell the user how many have no file. Music has no
// separators.
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
