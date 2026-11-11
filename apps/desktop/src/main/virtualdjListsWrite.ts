import {
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import log from 'electron-log/main'
import type {
  PlaylistAddReport,
  PlaylistTrackRef,
  RekordboxEditRefusal,
  RekordboxPlaylistEdit,
} from '../shared/types'
import { escapeXml } from '../shared/xml'
import type { BatchResult, CrateStamp, EditOp, OpOutcome, QueueOp } from './rekordboxQueueOps'
import { type FileStamp, fileStampOf } from './seratoLibraryWrite'
import { isVirtualdjHome, type VirtualdjRoot } from './virtualdjLibrary'
import type { VirtualdjCommit, VirtualdjCommitDeps } from './virtualdjLibraryWrite'
import { takeBackups } from './virtualdjLibraryWrite'
import { EXT, parseVirtualdjLinkId, SUB, virtualdjListRows } from './virtualdjLists'

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\r\n'
const NEW_LIST = `${XML_HEAD}<VirtualFolder noDuplicates="no">\r\n</VirtualFolder>\r\n`
const NEW_FOLDER = `${XML_HEAD}<VirtualFolder />\r\n`
const ORDER = 'order'
const WRITING = '.surco-write'
const ATTEMPTS = 3

export function virtualdjListsDir(roots: VirtualdjRoot[]): string | null {
  const home = roots.find(isVirtualdjHome)
  return home ? join(home.dir, 'MyLists') : null
}

export function validVirtualdjListName(name: string): boolean {
  return name.trim() !== '' && !/[/:]/.test(name)
}

interface Snapshot {
  files: Map<string, Buffer>
  dirs: Set<string>
  stamps: Map<string, FileStamp | null>
}

interface ListsDraft {
  root: string
  disk: Snapshot
  files: Map<string, Buffer>
  dirs: Set<string>
}

function snapshotOf(root: string): Snapshot {
  const snap: Snapshot = { files: new Map(), dirs: new Set(), stamps: new Map() }
  const walk = (dir: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    snap.dirs.add(dir)
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && !entry.name.endsWith(WRITING)) {
        snap.stamps.set(path, fileStampOf(path))
        snap.files.set(path, readFileSync(path))
      }
    }
  }
  walk(root)
  return snap
}

function createListsDraft(root: string): ListsDraft {
  const disk = snapshotOf(root)
  return { root, disk, files: new Map(disk.files), dirs: new Set(disk.dirs) }
}

const textOf = (d: ListsDraft, file: string): string | null =>
  d.files.get(file)?.toString('utf8') ?? null

function put(d: ListsDraft, file: string, text: string): void {
  d.dirs.add(dirname(file))
  d.files.set(file, Buffer.from(text, 'utf8'))
}

function levelOf(d: ListsDraft, parentId: string): string | null {
  if (parentId === 'root') return d.root
  let level = d.root
  for (const name of parentId.split('/')) {
    level = join(level, `${name}${SUB}`)
    if (!d.dirs.has(level)) return null
  }
  return level
}

const namesAt = (d: ListsDraft, level: string): string[] =>
  [...d.files.keys()]
    .filter((file) => dirname(file) === level && file.endsWith(EXT))
    .map((file) => basename(file).slice(0, -EXT.length))

const fold = (name: string): string => name.normalize('NFC').toLowerCase()

const taken = (d: ListsDraft, level: string, name: string, own?: string): boolean =>
  namesAt(d, level).some((n) => n !== own && fold(n) === fold(name))

function orderAt(d: ListsDraft, level: string): string[] {
  const lines = (textOf(d, join(level, ORDER)) ?? '').split('\n').map((l) => l.replace(/\r$/, ''))
  if (lines.at(-1) === '') lines.pop()
  const listed = new Set(lines)
  return [
    ...lines,
    ...namesAt(d, level)
      .filter((n) => !listed.has(n))
      .sort(),
  ]
}

const setOrder = (d: ListsDraft, level: string, names: string[]): void =>
  put(d, join(level, ORDER), names.map((n) => `${n}\n`).join(''))

interface ListNode {
  level: string
  name: string
  file: string
  sub: string
}

function nodeOf(d: ListsDraft, id: string): ListNode | null {
  const names = id.split('/')
  const name = names.pop() as string
  const level = levelOf(d, names.length === 0 ? 'root' : names.join('/'))
  if (level === null) return null
  const file = join(level, `${name}${EXT}`)
  if (!d.files.has(file)) return null
  return { level, name, file, sub: join(level, `${name}${SUB}`) }
}

const inside = (path: string, dir: string): boolean => path === dir || path.startsWith(`${dir}/`)

function moveNode(d: ListsDraft, node: ListNode, level: string, name: string): void {
  const file = join(level, `${name}${EXT}`)
  const sub = join(level, `${name}${SUB}`)
  const swap = (path: string): string =>
    path === node.file ? file : sub + path.slice(node.sub.length)
  for (const [path, bytes] of [...d.files])
    if (path === node.file || inside(path, node.sub)) {
      d.files.delete(path)
      d.files.set(swap(path), bytes)
    }
  for (const dir of [...d.dirs])
    if (inside(dir, node.sub)) {
      d.dirs.delete(dir)
      d.dirs.add(swap(dir))
    }
}

function removeNode(d: ListsDraft, node: ListNode): void {
  for (const path of [...d.files.keys()])
    if (path === node.file || inside(path, node.sub)) d.files.delete(path)
  for (const dir of [...d.dirs]) if (inside(dir, node.sub)) d.dirs.delete(dir)
}

function listFileOf(lists: string, id: string): string {
  const names = id.split('/')
  const name = names.pop() as string
  return join(lists, ...names.map((n) => `${n}${SUB}`), `${name}${EXT}`)
}

const rowsOf = (bytes: Buffer): CrateStamp => ({
  tracks: virtualdjListRows(bytes.toString('utf8')).map((r) => r.path),
})

const sameTracks = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((t, i) => t === b[i])

function listingOf(snap: Snapshot, sub: string): string[] {
  return [...snap.files.keys(), ...[...snap.dirs].filter((dir) => dir !== sub)]
    .filter((path) => inside(path, sub))
    .map((path) => relative(sub, path))
    .sort()
}

function stampNode(snap: Snapshot, file: string, files: Record<string, CrateStamp | null>): void {
  const bytes = snap.files.get(file)
  if (!bytes) return
  files[file] = rowsOf(bytes)
  const sub = `${file.slice(0, -EXT.length)}${SUB}`
  if (!snap.dirs.has(sub)) return
  files[sub] = { tracks: listingOf(snap, sub) }
  for (const [path, inner] of snap.files)
    if (inside(path, sub) && path.endsWith(EXT)) files[path] = rowsOf(inner)
}

const childId = (parentId: string, name: string): string =>
  parentId === 'root' ? name : `${parentId}/${name}`

export function virtualdjEditFiles(
  edit: RekordboxPlaylistEdit,
  roots: VirtualdjRoot[],
): Record<string, CrateStamp | null> {
  const lists = virtualdjListsDir(roots)
  if (!lists || edit.kind === 'insertSeparator') return {}
  const snap = snapshotOf(lists)
  const files: Record<string, CrateStamp | null> = {}
  if (edit.kind === 'create') {
    files[listFileOf(lists, childId(edit.parentId, edit.name.trim()))] = null
    return files
  }
  const own = listFileOf(lists, edit.playlistId)
  if (edit.kind === 'add' || edit.kind === 'move' || edit.kind === 'remove') {
    const bytes = snap.files.get(own)
    if (bytes) files[own] = rowsOf(bytes)
    return files
  }
  stampNode(snap, own, files)
  const name = basename(own).slice(0, -EXT.length)
  const target =
    edit.kind === 'rename'
      ? join(dirname(own), `${edit.name.trim()}${EXT}`)
      : edit.kind === 'moveNode'
        ? listFileOf(lists, childId(edit.parentId, name))
        : own
  if (fold(target) !== fold(own)) files[target] = null
  return files
}

export function badVirtualdjName(edit: RekordboxPlaylistEdit, roots: VirtualdjRoot[]): boolean {
  if (edit.kind !== 'create' && edit.kind !== 'rename' && edit.kind !== 'moveNode') return false
  if (edit.kind !== 'moveNode' && !validVirtualdjListName(edit.name)) return true
  const lists = virtualdjListsDir(roots)
  if (!lists) return false
  const d = createListsDraft(lists)
  if (edit.kind === 'create') {
    const level = levelOf(d, edit.parentId)
    return level !== null && taken(d, level, edit.name.trim())
  }
  const node = nodeOf(d, edit.playlistId)
  if (!node) return false
  if (edit.kind === 'rename') return taken(d, node.level, edit.name.trim(), node.name)
  const level = levelOf(d, edit.parentId)
  return level !== null && level !== node.level && taken(d, level, node.name)
}

type Row = { text: string } | { path: string; size: number }

const IDX_RE = /(\sidx=")[^"]*(")/

function withIdx(text: string, idx: number): string {
  if (IDX_RE.test(text)) return text.replace(IDX_RE, `$1${idx}$2`)
  return text.replace(/(\s*\/?>)(\s*)$/, ` idx="${idx}"$1$2`)
}

function lineSpans(xml: string): { start: number; end: number; text: string; path: string }[] {
  return virtualdjListRows(xml).map((row) => {
    let start = row.start
    while (start > 0 && (xml[start - 1] === ' ' || xml[start - 1] === '\t')) start--
    let end = row.end
    if (xml.startsWith('\r\n', end)) end += 2
    else if (xml[end] === '\n') end += 1
    return { start, end, text: xml.slice(start, end), path: row.path }
  })
}

function rewrittenList(xml: string, rows: Row[]): string | null {
  const spans = lineSpans(xml)
  const eol = xml.includes('\r\n') || !xml.includes('\n') ? '\r\n' : '\n'
  let head: string
  let tail: string
  let indent = '\t'
  if (spans.length > 0) {
    head = xml.slice(0, Math.min(...spans.map((s) => s.start)))
    tail = xml.slice(Math.max(...spans.map((s) => s.end)))
    indent = spans[0].text.slice(0, spans[0].text.indexOf('<'))
  } else {
    const close = xml.lastIndexOf('</VirtualFolder>')
    const empty = xml.match(/<VirtualFolder\b([^>]*?)\s*\/>/)
    if (close >= 0) {
      head = xml.slice(0, close)
      tail = xml.slice(close)
    } else if (empty?.index !== undefined) {
      head = `${xml.slice(0, empty.index)}<VirtualFolder${empty[1]}>${eol}`
      tail = `</VirtualFolder>${xml.slice(empty.index + empty[0].length)}`
    } else return null
  }
  const body = rows.map((row, idx) => {
    if (!('text' in row))
      return `${indent}<song path="${escapeXml(row.path)}" size="${row.size}" idx="${idx}" />${eol}`
    const text = withIdx(row.text, idx)
    return text.endsWith('\n') ? text : `${text}${eol}`
  })
  return `${head}${body.join('')}${tail}`
}

type Refused = { refused: RekordboxEditRefusal; report?: PlaylistAddReport }

function sizeOf(file: string): number | null {
  try {
    const stat = statSync(file)
    return stat.isFile() ? stat.size : null
  } catch {
    return null
  }
}

function addTracks(
  d: ListsDraft,
  playlistId: string,
  tracks: PlaylistTrackRef[],
): { report: PlaylistAddReport } | Refused {
  const node = nodeOf(d, playlistId)
  const xml = node && !d.dirs.has(node.sub) ? textOf(d, node.file) : null
  if (!node || xml === null) return { refused: 'stale' }
  const spans = lineSpans(xml)
  const report: PlaylistAddReport = { added: 0, already: 0, notInCollection: 0, ambiguous: 0 }
  const there = new Set(spans.map((s) => s.path.normalize('NFC')))
  const rows: Row[] = [...spans]
  for (const track of tracks) {
    const file = track.paths[track.paths.length - 1] ?? ''
    const size = sizeOf(file)
    if (there.has(file.normalize('NFC'))) report.already++
    else if (size === null) report.notInCollection++
    else {
      there.add(file.normalize('NFC'))
      rows.push({ path: file, size })
      report.added++
    }
  }
  if (report.added === 0) return { refused: 'nothing-to-add', report }
  const next = rewrittenList(xml, rows)
  if (next === null) return { refused: 'unreadable' }
  put(d, node.file, next)
  return { report }
}

function editRows(
  d: ListsDraft,
  edit: Extract<RekordboxPlaylistEdit, { kind: 'move' | 'remove' }>,
): RekordboxEditRefusal | null {
  const node = nodeOf(d, edit.playlistId)
  const xml = node && !d.dirs.has(node.sub) ? textOf(d, node.file) : null
  if (!node || xml === null) return 'stale'
  const spans = lineSpans(xml)
  const positions = (ids: string[]): number[] | null => {
    const out: number[] = []
    for (const id of ids) {
      const link = parseVirtualdjLinkId(id)
      const row = link && spans[link.index]
      if (!link || !row || row.path.normalize('NFC') !== link.path.normalize('NFC')) return null
      out.push(link.index)
    }
    return out
  }
  const moving = positions(edit.linkIds)
  if (!moving) return 'stale'
  const all = spans.map((_, i) => i)
  const rest = all.filter((i) => !moving.includes(i))
  let order = rest
  if (edit.kind === 'move') {
    const before = edit.beforeLinkId === null ? [] : positions([edit.beforeLinkId])
    if (!before) return 'stale'
    const at = before.length === 0 ? rest.length : rest.indexOf(before[0])
    if (at === -1) return 'stale'
    order = [...rest.slice(0, at), ...all.filter((i) => moving.includes(i)), ...rest.slice(at)]
  }
  const next = rewrittenList(
    xml,
    order.map((i) => spans[i]),
  )
  if (next === null) return 'unreadable'
  put(d, node.file, next)
  return null
}

function staleList(d: ListsDraft, op: EditOp): boolean {
  for (const [file, seen] of Object.entries(op.files ?? {})) {
    if (file.endsWith(SUB)) {
      const there = d.disk.dirs.has(file)
      if (seen === null && !there) continue
      if (seen === null || !there || !sameTracks(listingOf(d.disk, file), seen.tracks)) return true
      continue
    }
    const bytes = d.disk.files.get(file)
    if (seen === null && !bytes) continue
    if (seen === null || !bytes || !sameTracks(rowsOf(bytes).tracks, seen.tracks)) return true
  }
  return false
}

function applyTreeEdit(
  d: ListsDraft,
  edit: Extract<RekordboxPlaylistEdit, { kind: 'create' | 'rename' | 'delete' | 'moveNode' }>,
): { createdId?: string } | RekordboxEditRefusal {
  if (edit.kind === 'create') {
    const name = edit.name.trim()
    if (!validVirtualdjListName(name)) return 'bad-name'
    const level = levelOf(d, edit.parentId)
    if (level === null) return 'stale'
    if (taken(d, level, name)) return 'bad-name'
    const order = orderAt(d, level)
    const file = join(level, `${name}${EXT}`)
    if (edit.folder) {
      put(d, file, NEW_FOLDER)
      put(d, join(level, `${name}${SUB}`, ORDER), '')
    } else put(d, file, NEW_LIST)
    setOrder(d, level, [...order, name])
    return { createdId: edit.parentId === 'root' ? name : `${edit.parentId}/${name}` }
  }
  const node = nodeOf(d, edit.playlistId)
  if (!node) return 'stale'
  const order = orderAt(d, node.level).filter((n) => n !== node.name)
  if (edit.kind === 'delete') {
    removeNode(d, node)
    setOrder(d, node.level, order)
    return {}
  }
  if (edit.kind === 'rename') {
    const name = edit.name.trim()
    if (!validVirtualdjListName(name) || taken(d, node.level, name, node.name)) return 'bad-name'
    if (name === node.name) return {}
    const named = orderAt(d, node.level).map((n) => (n === node.name ? name : n))
    moveNode(d, node, node.level, name)
    setOrder(d, node.level, named)
    return {}
  }
  const level = levelOf(d, edit.parentId)
  if (level === null || inside(level, node.sub)) return 'stale'
  const same = level === node.level
  if (!same && taken(d, level, node.name)) return 'bad-name'
  const base = same ? order : orderAt(d, level)
  const before = edit.beforeId === null ? -1 : base.indexOf(edit.beforeId.split('/').at(-1) ?? '')
  const placed =
    before === -1
      ? [...base, node.name]
      : [...base.slice(0, before), node.name, ...base.slice(before)]
  if (!same) {
    moveNode(d, node, level, node.name)
    setOrder(d, node.level, order)
  }
  setOrder(d, level, placed)
  return {}
}

function applyListEdit(d: ListsDraft, op: EditOp): OpOutcome {
  const refused = (reason: RekordboxEditRefusal, report?: PlaylistAddReport): OpOutcome => ({
    id: op.id,
    applied: false,
    reason,
    notices: reason === 'stale' ? [{ code: 'edit-changed', playlist: op.label ?? '' }] : [],
    ...(report && { report }),
  })
  const done = (extra: Partial<OpOutcome> = {}): OpOutcome => ({
    id: op.id,
    applied: true,
    notices: [],
    ...extra,
  })
  if (staleList(d, op)) return refused('stale')
  const { edit } = op
  if (edit.kind === 'add') {
    const added = addTracks(d, edit.playlistId, edit.tracks)
    return 'refused' in added ? refused(added.refused, added.report) : done(added)
  }
  if (edit.kind === 'move' || edit.kind === 'remove') {
    const failed = editRows(d, edit)
    return failed ? refused(failed) : done()
  }
  if (edit.kind === 'insertSeparator') return refused('write-failed')
  const tree = applyTreeEdit(d, edit)
  if (typeof tree === 'string') return refused(tree)
  if (edit.kind !== 'create' || !edit.tracks || !tree.createdId) return done(tree)
  const filled = addTracks(d, tree.createdId, edit.tracks)
  if ('refused' in filled && filled.refused !== 'nothing-to-add') return refused(filled.refused)
  return done({ ...tree, ...(filled.report && { report: filled.report }) })
}

type Step = { run: () => void; undo: () => void; files: string[] }

async function commitLists(d: ListsDraft, deps: VirtualdjCommitDeps): Promise<VirtualdjCommit> {
  const writes = [...d.files].filter(([file, bytes]) => !d.disk.files.get(file)?.equals(bytes))
  const removals = [...d.disk.files.keys()].filter((file) => !d.files.has(file))
  const newDirs = [...d.dirs]
    .filter((dir) => !d.disk.dirs.has(dir))
    .sort((a, b) => a.length - b.length)
  const goneDirs = [...d.disk.dirs]
    .filter((dir) => !d.dirs.has(dir))
    .sort((a, b) => b.length - a.length)
  if (writes.length + removals.length + newDirs.length + goneDirs.length === 0) return 'nothing'
  for (const [file] of writes)
    try {
      rmSync(`${file}${WRITING}`, { force: true })
    } catch (e) {
      log.warn(`VirtualDJ temp ${file}${WRITING} not removed`, e)
    }
  if (await deps.virtualdjOpen()) return 'cancelled'
  try {
    if (d.disk.files.size > 0) takeBackups([...d.disk.files.keys()], deps)
  } catch (e) {
    log.warn('VirtualDJ lists backup failed', e)
    return 'backup-failed'
  }
  const restore = (file: string): void => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, d.disk.files.get(file) as Buffer)
  }
  const temps = new Set<string>()
  const steps: Step[] = [
    ...removals.map((file) => ({
      run: () => rmSync(file),
      undo: () => restore(file),
      files: [file],
    })),
    ...goneDirs.map((dir) => ({
      run: () => rmdirSync(dir),
      undo: () => mkdirSync(dir, { recursive: true }),
      files: [],
    })),
    ...newDirs.map((dir) => ({ run: () => mkdirSync(dir), undo: () => rmdirSync(dir), files: [] })),
    ...writes.map(([file, bytes]) => {
      const tmp = `${file}${WRITING}`
      temps.add(tmp)
      return {
        run: () => {
          writeFileSync(tmp, bytes)
          renameSync(tmp, file)
          temps.delete(tmp)
        },
        undo: () => (d.disk.files.has(file) ? restore(file) : rmSync(file, { force: true })),
        files: [file],
      }
    }),
  ]
  const touched = new Set<string>()
  const done: Step[] = []
  const rollback = (): boolean => {
    try {
      for (const tmp of temps) rmSync(tmp, { force: true })
      for (const step of done.reverse()) step.undo()
      return true
    } catch (e) {
      log.error('VirtualDJ lists rollback failed', e)
      return false
    }
  }
  const refusal = async (): Promise<VirtualdjCommit | null> => {
    if (await deps.virtualdjOpen()) return 'cancelled'
    for (const [file, stamp] of d.disk.stamps) {
      if (touched.has(file)) continue
      const now = fileStampOf(file)
      if (now?.mtimeMs !== stamp?.mtimeMs || now?.size !== stamp?.size) return 'changed'
    }
    return null
  }
  try {
    for (const step of steps) {
      const refused = await refusal()
      if (refused) return rollback() ? refused : 'write-unknown'
      for (const file of step.files) touched.add(file)
      step.run()
      done.push(step)
    }
    return 'written'
  } catch (e) {
    log.warn('VirtualDJ lists write failed', e)
    return rollback() ? 'write-failed' : 'write-unknown'
  }
}

export async function applyVirtualdjListOps(
  ops: QueueOp[],
  deps: VirtualdjCommitDeps & {
    ensureClosed: () => Promise<boolean>
    stillQueued?: (id: string) => boolean
  },
): Promise<BatchResult> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (!(await deps.ensureClosed())) return { ok: false, reason: 'cancelled' }
    const lists = virtualdjListsDir(deps.roots())
    if (!lists) return { ok: false, reason: 'unreadable' }
    const d = createListsDraft(lists)
    const outcomes = ops.map(
      (op): OpOutcome =>
        deps.stillQueued && !deps.stillQueued(op.id)
          ? { id: op.id, applied: false, reason: 'cancelled', notices: [] }
          : op.kind === 'edit'
            ? applyListEdit(d, op)
            : { id: op.id, applied: false, reason: 'write-failed', notices: [] },
    )
    const written = await commitLists(d, deps)
    if (written === 'changed') continue
    if (written !== 'written' && written !== 'nothing') return { ok: false, reason: written }
    return { ok: true, wrote: written === 'written', outcomes }
  }
  log.info('VirtualDJ lists kept changing while Surco wrote, nothing written')
  return { ok: false, reason: 'cancelled' }
}
