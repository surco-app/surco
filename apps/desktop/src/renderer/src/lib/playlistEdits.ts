import type { TFunction } from 'i18next'
import type {
  RekordboxEditRefusal,
  RekordboxEditResult,
  RekordboxPlaylistEdit,
  SourceNode,
  SourcePlaylistEntry,
} from '../../../shared/types'
import type { EditMessagePrefix } from './sourcePrograms'

// The move rule of the writer (rekordboxPlaylistEdit.moveInPlaylist, which applies it in
// SQL in main), written once for the renderer: the moved items keep their order and land
// before the target, every other item keeps its place. The optimistic reorder below and
// the list's drop (TrackList) both use it, so what the list draws is what main writes.
export function moveBefore<T>(
  items: readonly T[],
  keyOf: (item: T) => string | undefined,
  moving: ReadonlySet<string>,
  before: string | null,
): T[] | null {
  const isMoving = (item: T): boolean => {
    const key = keyOf(item)
    return key !== undefined && moving.has(key)
  }
  const moved = items.filter(isMoving)
  const rest = items.filter((item) => !isMoving(item))
  const at = before === null ? rest.length : rest.findIndex((item) => keyOf(item) === before)
  if (at === -1) return null
  return [...rest.slice(0, at), ...moved, ...rest.slice(at)]
}

// The playlist as it will read once a move is written.
export function movedEntries(
  entries: SourcePlaylistEntry[],
  linkIds: string[],
  beforeLinkId: string | null,
): SourcePlaylistEntry[] {
  return moveBefore(entries, (e) => e.linkId, new Set(linkIds), beforeLinkId) ?? entries
}

const REFUSED: Record<Exclude<RekordboxEditRefusal, 'nothing-to-add'>, string> = {
  cancelled: 'sources.edit.refused.cancelled',
  'rekordbox-running': 'sources.edit.refused.running',
  unreadable: 'sources.edit.refused.unreadable',
  'backup-failed': 'sources.edit.refused.backupFailed',
  'write-failed': 'sources.edit.refused.writeFailed',
  'write-unknown': 'sources.edit.refused.writeUnknown',
  'read-only': 'sources.edit.refused.readOnly',
  stale: 'sources.edit.refused.stale',
  'no-separator': 'sources.edit.refused.noSeparator',
  'bad-name': 'sources.edit.refused.badName',
}

const WAITING: ReadonlySet<RekordboxEditRefusal> = new Set(['cancelled', 'rekordbox-running'])

export function subtreeCounts(node: SourceNode): { playlists: number; folders: number } {
  let playlists = 0
  let folders = 0
  const walk = (nodes: readonly SourceNode[]): void => {
    for (const n of nodes) {
      if (n.kind === 'folder') folders += 1
      else playlists += 1
      walk(n.children ?? [])
    }
  }
  walk(node.children ?? [])
  return { playlists, folders }
}

export function refusalKey(reason: Exclude<RekordboxEditRefusal, 'nothing-to-add'>): string {
  return REFUSED[reason]
}

// The line the user reads after an edit, or null when the list itself already shows what
// happened. An add always reports, because tracks it could not add vanish from the gesture
// with no other trace.
export function editMessage(
  tr: TFunction,
  edit: RekordboxPlaylistEdit,
  result: RekordboxEditResult,
  playlistName: string,
  messagePrefix: EditMessagePrefix = 'sources.edit.',
): { text: string; tone: 'neutral' | 'danger' } | null {
  const own = (key: string): string => key.replace('sources.edit.', messagePrefix)
  if (!result.applied && result.reason !== 'nothing-to-add')
    return {
      text: tr(own(REFUSED[result.reason])),
      tone: WAITING.has(result.reason) ? 'neutral' : 'danger',
    }
  if (edit.kind !== 'add' || !result.report) return null
  const r = result.report
  const parts = [
    r.added > 0
      ? tr(own('sources.edit.added'), { count: r.added, name: playlistName })
      : tr(own('sources.edit.noneAdded'), { name: playlistName }),
  ]
  if (r.already > 0) parts.push(tr(own('sources.edit.already'), { count: r.already }))
  if (r.notInCollection > 0)
    parts.push(tr(own('sources.edit.notInCollection'), { count: r.notInCollection }))
  if (r.ambiguous > 0) parts.push(tr(own('sources.edit.ambiguous'), { count: r.ambiguous }))
  return { text: parts.join('. '), tone: 'neutral' }
}

export const PENDING_NODE = 'pending:'

export const isPendingNode = (id: string): boolean => id.startsWith(PENDING_NODE)

export function subtreeIds(nodes: readonly SourceNode[], id: string): string[] {
  const node = findNode(nodes, id)
  return node ? walkIds(node) : []
}

function walkIds(node: SourceNode): string[] {
  return [node.id, ...(node.children ?? []).flatMap(walkIds)]
}

export function movedCrateId(id: string, parentId: string): string {
  const name = id.split('%%').at(-1) ?? id
  return parentId === 'root' ? name : `${parentId}%%${name}`
}

function renamedCrates(node: SourceNode, from: string, to: string): SourceNode {
  const next: SourceNode = { ...node, id: to + node.id.slice(from.length) }
  if (node.children) next.children = node.children.map((c) => renamedCrates(c, from, to))
  return next
}

function findNode(nodes: readonly SourceNode[], id: string): SourceNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const inside = findNode(node.children ?? [], id)
    if (inside) return inside
  }
  return undefined
}

function mapNode(
  nodes: readonly SourceNode[],
  id: string,
  change: (node: SourceNode) => SourceNode,
): SourceNode[] {
  return nodes.map((node) => {
    if (node.id === id) return change(node)
    if (!node.children) return node
    return { ...node, children: mapNode(node.children, id, change) }
  })
}

function withoutNode(nodes: readonly SourceNode[], id: string): SourceNode[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) => (node.children ? { ...node, children: withoutNode(node.children, id) } : node))
}

function intoChildren(
  nodes: readonly SourceNode[],
  parentId: string,
  place: (siblings: SourceNode[]) => SourceNode[] | null,
): SourceNode[] | null {
  if (parentId === 'root') return place([...nodes])
  if (!findNode(nodes, parentId)) return null
  let failed = false
  const next = mapNode(nodes, parentId, (parent) => {
    const placed = place([...(parent.children ?? [])])
    if (!placed) {
      failed = true
      return parent
    }
    return { ...parent, children: placed }
  })
  return failed ? null : next
}

const byName = (a: SourceNode, b: SourceNode): number =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase())

export function editedTree(
  nodes: SourceNode[],
  edit: RekordboxPlaylistEdit,
  options: { crates?: boolean } = {},
): SourceNode[] | null {
  if (edit.kind === 'create') {
    const created: SourceNode = {
      id: `${PENDING_NODE}${crypto.randomUUID()}`,
      name: edit.name,
      kind: edit.folder ? 'folder' : 'playlist',
      count: 0,
      ...(edit.folder ? { children: [] } : {}),
    }
    return intoChildren(nodes, edit.parentId, (siblings) => [...siblings, created])
  }
  if (edit.kind === 'rename') {
    if (!findNode(nodes, edit.playlistId)) return null
    return mapNode(nodes, edit.playlistId, (node) => ({
      ...node,
      name: edit.name,
    }))
  }
  if (edit.kind === 'delete') {
    if (!findNode(nodes, edit.playlistId)) return null
    return withoutNode(nodes, edit.playlistId)
  }
  if (edit.kind !== 'moveNode') return null
  const moving = findNode(nodes, edit.playlistId)
  if (!moving) return null
  if (subtreeIds(nodes, moving.id).includes(edit.parentId)) return null
  const rest = withoutNode(nodes, moving.id)
  return intoChildren(rest, edit.parentId, (siblings) => {
    if (options.crates) {
      const renamed = renamedCrates(moving, moving.id, movedCrateId(moving.id, edit.parentId))
      return [...siblings, renamed].sort(byName)
    }
    return moveBefore([...siblings, moving], (n) => n.id, new Set([moving.id]), edit.beforeId)
  })
}
