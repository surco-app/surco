import { randomBytes } from 'node:crypto'
import { TRAKTOR_BUILT_IN, TRAKTOR_HISTORY, traktorKey } from '../shared/traktorContent'
import type { PlaylistAddReport, RekordboxEditRefusal } from '../shared/types'
import { type EditOp, type OpOutcome, opRank, type TrackOp } from './rekordboxQueueOps'
import { escapeAttr, withAttr } from './traktorNml'
import {
  type ModelNode,
  type ModelRow,
  nodeById,
  type PlaylistModel,
  parsePlaylists,
  serializePlaylists,
  stampOf,
} from './traktorPlaylistModel'
import { traktorCollectionIndex, traktorSeparatorKey } from './traktorPlaylists'

const builtIn = (node: ModelNode): boolean =>
  node.parent?.id === 'root' && TRAKTOR_BUILT_IN.has(node.name)
const history = (node: ModelNode): boolean => builtIn(node) && node.name === TRAKTOR_HISTORY

const rowText = (key: string, eol: string): string =>
  `<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="${escapeAttr(key)}"></PRIMARYKEY>${eol}</ENTRY>`

function newNode(parent: ModelNode, name: string, folder: boolean): ModelNode {
  const uuid = folder ? '' : randomBytes(16).toString('hex')
  const open = `<NODE TYPE="${folder ? 'FOLDER' : 'PLAYLIST'}" NAME="${escapeAttr(name)}">`
  const inner = folder
    ? '<SUBNODES COUNT="0">'
    : `<PLAYLIST ENTRIES="0" TYPE="LIST" UUID="${uuid}">`
  return {
    id: uuid,
    kind: folder ? 'folder' : 'playlist',
    name,
    uuid,
    open,
    inner,
    rows: [],
    children: [],
    parent,
    text: '',
    dirty: true,
  }
}

// Every id an edit names is looked up in the collection as read, before any edit of the
// batch applies: what the DJ saw while Traktor was open is that file, so a move and a
// remove queued on one playlist both mean the rows as they were.
interface Resolved {
  op: EditOp
  node: ModelNode | null
  rows: ModelRow[]
  before: ModelRow | null
}

function rowAt(node: ModelNode | null, linkId: string): ModelRow | undefined {
  if (!node) return undefined
  const [uuid, index, ...key] = linkId.split(':')
  const row = uuid === node.uuid ? node.rows[Number(index)] : undefined
  return row && row.key === key.join(':') ? row : undefined
}

function resolve(model: PlaylistModel | null, op: EditOp): Resolved | null {
  const { edit } = op
  const id = edit.kind === 'create' ? edit.parentId : edit.playlistId
  const node = nodeById(model, id)
  if (!node) return null
  const rows =
    edit.kind === 'move' || edit.kind === 'remove' ? edit.linkIds.map((l) => rowAt(node, l)) : []
  if (rows.some((r) => r === undefined)) return null
  const beforeId =
    edit.kind === 'move'
      ? edit.beforeLinkId
      : edit.kind === 'insertSeparator'
        ? edit.beforeLinkId
        : null
  const before = beforeId === null ? null : (rowAt(node, beforeId) ?? null)
  if (beforeId !== null && before === null) return null
  return { op, node, rows: rows as ModelRow[], before }
}

function stale(op: EditOp, model: PlaylistModel | null): OpOutcome | null {
  for (const [id, stamp] of Object.entries(op.stamps)) {
    const node = nodeById(model, id)
    if (!node || stampOf(node) !== stamp)
      return {
        id: op.id,
        applied: false,
        reason: 'stale',
        notices: [{ code: 'edit-changed', playlist: node?.name ?? op.label ?? '' }],
      }
  }
  return null
}

interface Sources {
  index: ReturnType<typeof traktorCollectionIndex>
  separator: string | null
  eol: string
}

function apply(r: Resolved, src: Sources): OpOutcome {
  const { op } = r
  const node = r.node as ModelNode
  const { edit } = op
  const refused = (reason: RekordboxEditRefusal, report?: PlaylistAddReport): OpOutcome => ({
    id: op.id,
    applied: false,
    reason,
    ...(report && { report }),
    notices: [],
  })
  const done = (extra: Partial<OpOutcome> = {}): OpOutcome => ({
    id: op.id,
    applied: true,
    notices: [],
    ...extra,
  })
  const playlist = node.kind === 'playlist' && !history(node)
  if (edit.kind === 'create') {
    const name = edit.name.trim()
    if (node.kind !== 'folder' || name === '') return refused('stale')
    const child = newNode(node, name, edit.folder)
    node.children.push(child)
    node.dirty = true
    return done(edit.folder ? {} : { createdId: child.uuid })
  }
  if (edit.kind === 'rename') {
    const name = edit.name.trim()
    if (node.kind === 'smartlist' || node.id === 'root' || builtIn(node) || name === '')
      return refused('stale')
    node.open = withAttr(node.open, 'NAME', escapeAttr(name))
    node.name = name
    node.dirty = true
    return done()
  }
  if (edit.kind === 'delete') {
    if (node.id === 'root' || builtIn(node) || !node.parent) return refused('stale')
    node.parent.children = node.parent.children.filter((c) => c !== node)
    node.parent.dirty = true
    return done()
  }
  if (!playlist) return refused('stale')
  if (edit.kind === 'add') {
    const report: PlaylistAddReport = { added: 0, already: 0, notInCollection: 0, ambiguous: 0 }
    const present = new Set(node.rows.map((r) => r.key))
    const keys: string[] = []
    for (const t of edit.tracks) {
      const byId = t.contentId ? traktorKey(t.contentId) : null
      const found =
        byId && src.index.keys.has(byId)
          ? [byId]
          : [...new Set(t.paths.flatMap((p) => src.index.byPath.get(p.normalize('NFC')) ?? []))]
      if (found.length > 1) report.ambiguous++
      else if (found.length === 0) report.notInCollection++
      else if (present.has(found[0]) || keys.includes(found[0])) report.already++
      else keys.push(found[0])
    }
    if (keys.length === 0) return refused('nothing-to-add', report)
    node.rows.push(...keys.map((key) => ({ key, text: rowText(key, src.eol) })))
    node.dirty = true
    return done({ report: { ...report, added: keys.length } })
  }
  if (edit.kind === 'remove') {
    node.rows = node.rows.filter((row) => !r.rows.includes(row))
    node.dirty = true
    return done()
  }
  if (edit.kind === 'move') {
    const moving = node.rows.filter((row) => r.rows.includes(row))
    const rest = node.rows.filter((row) => !r.rows.includes(row))
    const at = r.before && rest.includes(r.before) ? rest.indexOf(r.before) : rest.length
    const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)]
    if (next.some((row, i) => row !== node.rows[i])) {
      node.rows = next
      node.dirty = true
    }
    return done()
  }
  if (!src.separator) return refused('no-separator')
  const at = r.before ? node.rows.indexOf(r.before) : -1
  if (at < 0) return refused('stale')
  node.rows.splice(at, 0, { key: src.separator, text: rowText(src.separator, src.eol) })
  node.dirty = true
  return done()
}

function keyOfTrack(op: TrackOp, index: Sources['index']): string | null {
  const byId = op.contentId ? traktorKey(op.contentId) : null
  if (byId && index.keys.has(byId)) return byId
  for (const path of [op.path, ...(op.from ? [op.from] : [])]) {
    const found = index.byPath.get(path.normalize('NFC')) ?? []
    if (found.length === 1) return found[0]
  }
  return null
}

function playlistsOf(model: PlaylistModel | null): ModelNode[] {
  const out: ModelNode[] = []
  const walk = (node: ModelNode): void => {
    if (node.kind === 'playlist' && !history(node)) out.push(node)
    node.children.forEach(walk)
  }
  if (model) walk(model.root)
  return out
}

function applyTrack(op: TrackOp, model: PlaylistModel | null, src: Sources): OpOutcome {
  const key = keyOfTrack(op, src.index)
  if (!key || !model)
    return { id: op.id, applied: false, notices: [{ code: 'not-in-library', track: op.label }] }
  const notices: OpOutcome['notices'] = []
  const lists = playlistsOf(model)
  const holding = lists.filter((l) => l.rows.some((r) => r.key === key))
  const wantedIds = new Set<string>()
  for (const target of op.wanted) {
    const name = target.name.trim()
    let node = target.id
      ? lists.find((l) => l.id === target.id)
      : lists.find((l) => l.parent === model.root && l.name === name)
    if (!node && !target.id && name !== '') {
      node = newNode(model.root, name, false)
      model.root.children.push(node)
      model.root.dirty = true
      lists.push(node)
    }
    if (!node) {
      notices.push({ code: 'playlist-gone', track: op.label, playlist: target.name })
      continue
    }
    wantedIds.add(node.id)
    if (holding.includes(node)) continue
    node.rows.push({ key, text: rowText(key, src.eol) })
    node.dirty = true
  }
  for (const node of holding) {
    if (wantedIds.has(node.id)) continue
    if (!op.known.includes(node.id)) {
      notices.push({ code: 'playlist-changed', track: op.label, playlist: node.name })
      continue
    }
    node.rows = node.rows.filter((r) => r.key !== key)
    node.dirty = true
  }
  return { id: op.id, applied: true, notices }
}

export function applyTraktorEdits(
  nml: string,
  allOps: (EditOp | TrackOp)[],
  bootVolume: string,
): { nml: string; outcomes: Map<string, OpOutcome> } {
  const model = parsePlaylists(nml)
  const outcomes = new Map<string, OpOutcome>()
  const resolved: Resolved[] = []
  const ops = allOps.filter((op): op is EditOp => op.kind === 'edit')
  for (const op of ops) {
    const changed = stale(op, model)
    const r = changed ? null : resolve(model, op)
    if (changed) outcomes.set(op.id, changed)
    else if (!r) outcomes.set(op.id, { id: op.id, applied: false, reason: 'stale', notices: [] })
    else resolved.push(r)
  }
  const src: Sources = {
    index: traktorCollectionIndex(nml, bootVolume),
    separator: traktorSeparatorKey(nml),
    eol: nml.includes('\r\n') ? '\r\n' : '\n',
  }
  for (const r of [...resolved].sort((a, b) => opRank(a.op) - opRank(b.op)))
    outcomes.set(r.op.id, apply(r, src))
  for (const op of allOps) if (op.kind === 'track') outcomes.set(op.id, applyTrack(op, model, src))
  return { nml: serializePlaylists(nml, model), outcomes }
}
