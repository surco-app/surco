import { extname } from 'node:path'
import type { RekordboxPlaylistTarget } from '../shared/types'
import type { PlaceCheck, VerifyDetailKey } from '../shared/verification'
import { formatOf } from './verifyFile'
import { readVirtualdjLibrary, type VirtualdjRoot } from './virtualdjLibrary'
import type { VirtualdjNode } from './virtualdjLists'
import { virtualdjPathKey } from './virtualdjPaths'

export type VirtualdjBefore =
  | { lists: { id: string; name: string }[]; listOnly?: true }
  | 'absent'
  | 'unreadable'

export interface VirtualdjExpect {
  from: string
  to: string
  before: VirtualdjBefore
  size: number
  playlists?: RekordboxPlaylistTarget[]
}

function listsOf(nodes: VirtualdjNode[]): VirtualdjNode[] {
  return nodes.flatMap((n) => (n.kind === 'playlist' ? [n] : listsOf(n.children ?? [])))
}

const holding = (lists: VirtualdjNode[], path: string) =>
  lists.filter((l) => l.paths.some((p) => virtualdjPathKey(p) === virtualdjPathKey(path)))

export function snapshotVirtualdjSong(roots: VirtualdjRoot[], from: string): VirtualdjBefore {
  const library = readVirtualdjLibrary(roots)
  const song = library.songs.some((s) => virtualdjPathKey(s.path) === virtualdjPathKey(from))
  const lists = holding(listsOf(library.lists), from)
  if (!song && lists.length === 0) return 'absent'
  return {
    lists: lists.map((l) => ({ id: l.id, name: l.name })),
    ...(song ? {} : { listOnly: true as const }),
  }
}

const check = (
  state: PlaceCheck['state'],
  key: VerifyDetailKey,
  params?: Record<string, string | number | string[]>,
): PlaceCheck => ({
  place: 'virtualdj',
  state,
  detail: params ? { key, params } : { key },
})

export function checkVirtualdj(roots: VirtualdjRoot[], list: VirtualdjExpect[]): PlaceCheck[] {
  const library = readVirtualdjLibrary(roots)
  const lists = listsOf(library.lists)
  const top = new Set(library.lists.map((n) => n.id))
  const songsAt = (path: string) =>
    library.songs.filter((s) => virtualdjPathKey(s.path) === virtualdjPathKey(path))
  return list.map((e) => {
    if (e.before === 'unreadable')
      return { ...check('unreadable', 'virtualdjUnreadable'), final: true }
    if (virtualdjPathKey(e.from) !== virtualdjPathKey(e.to) && songsAt(e.from).length > 0)
      return check('mismatch', 'virtualdjStillOld', { format: formatOf(extname(e.from)) })
    const [song] = songsAt(e.to)
    const listOnly = typeof e.before === 'object' && e.before.listOnly === true
    if (!song && !listOnly) return check('mismatch', 'virtualdjMissing')
    if (song && song.size !== e.size) return check('mismatch', 'virtualdjSizeDiffers')
    const held = holding(lists, e.to)
    const had = typeof e.before === 'object' ? e.before.lists : []
    const lost = had.find((l) => !held.some((h) => h.id === l.id))
    if (lost) return check('mismatch', 'virtualdjPlaylistMissing', { playlist: lost.name })
    const wanted = e.playlists ?? []
    const missing = wanted.find(
      (t) => !held.some((h) => (t.id ? h.id === t.id : top.has(h.id) && h.name === t.name.trim())),
    )
    if (missing) return check('mismatch', 'virtualdjPlaylistMissing', { playlist: missing.name })
    return check('ok', 'virtualdjOk', {
      format: formatOf(extname(e.to)),
      ...(wanted.length > 0 ? { playlists: wanted.map((t) => t.name) } : {}),
    })
  })
}
