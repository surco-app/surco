import { existsSync } from 'node:fs'
import { chmod, copyFile, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import log from 'electron-log/main'
import type {
  PlaylistAddReport,
  RekordboxEditRefusal,
  RekordboxEditResult,
  RekordboxPlaylistEdit,
  RekordboxQueueNotice,
} from '../shared/types'
import { type ContentFacts, insertContent } from './rekordboxContentAdd'
import { type FindOptions, openRekordboxDb } from './rekordboxDb'
import {
  hexId,
  nodeTimestamp,
  playlistXmlPath,
  withoutNodes,
  withPlaylistNode,
  xmlNodeIds,
} from './rekordboxMasterXml'
import {
  addToPlaylist,
  createNode,
  deleteNode,
  EditRefused,
  editProblem,
  insertSeparator,
  moveChangesOrder,
  moveInPlaylist,
  nodeAttribute,
  playlistContents,
  randomPlaylistId,
  removeFromPlaylist,
  removeTrackFromPlaylist,
  renameNode,
  resolveTracks,
  trackPlaylists,
} from './rekordboxPlaylistEdit'
import { isRekordboxRunning } from './rekordboxProcess'
import {
  type BatchResult,
  bumpNode,
  type EditOp,
  editResultOfOutcome,
  type OpOutcome,
  opRank,
  type QueueOp,
  type TrackOp,
  type XmlDraft,
} from './rekordboxQueueOps'
import { writeBackup } from './rekordboxSessionBackup'

// Writes a batch of organising operations into the user's rekordbox collection, the one
// library they cannot rebuild. Same bargain as the repoint (rekordboxLibrary.ts): the
// operations are planned on a read-only handle first, so a batch with nothing to write (or
// one the XML cannot take) never asks the user to close rekordbox; rekordbox must be closed
// (asked once, then checked again right before the write); there is a complete copy for the
// session and one for this write before anything changes; and the operations run in one
// transaction, a savepoint each, that also covers the XML, written just before the commit. A failure is undone by SQLite's own
// rollback, not by copying files over the user's: only an XML already written goes back
// from its copy, and master.db is copied back only when its state is unknown.

const BACKUP_SUFFIX = '.surco-backup'

export interface PlaylistWriteDeps extends FindOptions {
  // Asks the user to close rekordbox when it is open; false means it is still open.
  ensureClosed: () => Promise<boolean>
  // The session's one pre-edit copy (rekordboxSessionBackup.ts); throws if it cannot copy.
  sessionBackup: (path: string) => Promise<void>
  now?: () => Date
  // Seams for the tests to fail the write after it has really changed something.
  onWrite?: () => void
  onRollback?: () => void
  writeXml?: (path: string, text: string) => Promise<void>
}

// Written beside and renamed over, so rekordbox never finds a half-written file. The temp
// file is born with the default mode; given the original's before the rename, so the
// replacement does not quietly change permissions set on the user's file.
export async function replaceFile(path: string, text: string): Promise<void> {
  const temp = `${path}.surco-tmp`
  try {
    const { mode } = await stat(path)
    await writeFile(temp, text, 'utf8')
    await chmod(temp, mode)
    await rename(temp, path)
  } catch (err) {
    // A half step left in rekordbox's folder would stay there for good.
    await rm(temp, { force: true })
    throw err
  }
}

// The collection is in WAL mode (measured), so committed changes can still sit in
// master.db-wal. Folding them into master.db first is what makes a copy of master.db a
// complete backup; it changes nothing rekordbox would see. A connection still reading an
// older snapshot blocks the fold, and SQLite reports that only in the result (busy, or
// fewer frames checkpointed than the log holds), never by throwing: then there is no
// complete backup, and no write.
function checkpoint(collectionPath: string): void {
  const db = openRekordboxDb(collectionPath)
  if (!db) throw new Error('rekordbox collection could not be opened')
  try {
    // Synchronous in the main process: a reader that blocks the fold must answer quickly
    // instead of freezing the window for the default 5 s busy wait.
    db.pragma('busy_timeout = 250')
    const [result] = db.pragma('wal_checkpoint(TRUNCATE)') as {
      busy: number
      log: number
      checkpointed: number
    }[]
    if (result.busy !== 0 || result.log !== result.checkpointed) {
      throw new Error('rekordbox collection WAL could not be folded into master.db')
    }
  } finally {
    db.close()
  }
}

const isReadOnly = (err: unknown): boolean =>
  String((err as { code?: unknown })?.code).startsWith('SQLITE_READONLY')

// Whether the XML can take a new node at all, decided before rekordbox is asked to close.
// The text edit refuses a layout it would have to guess at; the ID and the parent are
// placeholders, only the layout is being checked.
async function xmlTakesNode(xmlPath: string): Promise<boolean> {
  try {
    withPlaylistNode(await readFile(xmlPath, 'utf8'), {
      id: '100',
      parentId: 'root',
      attribute: 0,
      timestamp: 0,
    })
    return true
  } catch {
    return false
  }
}

// Through replaceFile rather than a copy over it: the write kept a read-only file read-only,
// and a copy onto it is refused.
async function restoreFile(path: string): Promise<void> {
  try {
    await replaceFile(path, await readFile(`${path}${BACKUP_SUFFIX}`, 'utf8'))
  } catch (err) {
    log.error(`rekordbox ${path} could not be restored from ${BACKUP_SUFFIX}: ${String(err)}`)
  }
}

// The last resort, for a collection whose state after a failure is unknown (a rollback
// that itself failed). Called with every connection of Surco's closed. A -wal with frames
// still beside master.db would be replayed by SQLite over the copied-back file, mixing
// the two; then nothing is overwritten and the copies stay on disk for the user.
export async function restoreCollection(collectionPath: string): Promise<boolean> {
  const wal = `${collectionPath}-wal`
  if (existsSync(wal) && (await stat(wal)).size > 0) {
    log.error(
      `rekordbox ${collectionPath} not restored: its -wal still holds frames; the backups ${BACKUP_SUFFIX} and .surco-session are intact`,
    )
    return false
  }
  try {
    await copyFile(`${collectionPath}${BACKUP_SUFFIX}`, collectionPath)
    return true
  } catch (err) {
    log.error(`rekordbox ${collectionPath} could not be restored: ${String(err)}`)
    return false
  }
}

// Undoes the open transaction; false when even that failed, so the collection's state is
// no longer known.
function rollback(
  db: NonNullable<ReturnType<typeof openRekordboxDb>>,
  onRollback?: () => void,
): boolean {
  try {
    onRollback?.()
    if (db.inTransaction) db.exec('ROLLBACK')
    return true
  } catch (err) {
    log.error(`rekordbox playlist edit rollback failed: ${String(err)}`)
    return false
  }
}

type Db = NonNullable<ReturnType<typeof openRekordboxDb>>

interface Planned {
  op: QueueOp
  contentIds?: string[]
  unresolved?: { notInCollection: number; ambiguous: number }
  track?: {
    entry?: string
    adds: string[]
    removes: string[]
    names: string[]
    notices: RekordboxQueueNotice[]
  }
}

type Plan = Planned | { outcome: OpOutcome }

function playlistName(db: Db, id: string): string {
  const row = db.prepare('SELECT Name FROM djmdPlaylist WHERE ID = ?').get(id) as
    | { Name: string }
    | undefined
  return row?.Name ?? id
}

function changedOutcome(db: Db, xml: string | null, op: EditOp): OpOutcome | null {
  if (xml === null) return null
  for (const [playlistId, stamp] of Object.entries(op.stamps)) {
    if (nodeTimestamp(xml, playlistId) !== stamp)
      return {
        id: op.id,
        applied: false,
        reason: 'stale',
        notices: [{ code: 'edit-changed', playlist: playlistName(db, playlistId) }],
      }
  }
  return null
}

function planEdit(probe: Db, xml: string | null, op: EditOp, find: FindOptions): Plan {
  const { edit } = op
  const refused = (reason: RekordboxEditRefusal, report?: PlaylistAddReport): Plan => ({
    outcome: report
      ? { id: op.id, applied: false, reason, report, notices: [] }
      : { id: op.id, applied: false, reason, notices: [] },
  })
  const problem = editProblem(probe, edit)
  if (problem) return refused(problem)
  const changed = changedOutcome(probe, xml, op)
  if (changed) return { outcome: changed }
  if (
    edit.kind === 'move' &&
    !moveChangesOrder(probe, edit.playlistId, edit.linkIds, edit.beforeLinkId)
  )
    return { outcome: { id: op.id, applied: true, notices: [] } }
  if (edit.kind === 'add') {
    const resolved = resolveTracks(probe, edit.tracks, find)
    const unresolved = { notInCollection: resolved.notInCollection, ambiguous: resolved.ambiguous }
    const present = playlistContents(probe, edit.playlistId)
    const already = resolved.contentIds.filter((id) => present.has(id)).length
    if (already === resolved.contentIds.length)
      return refused('nothing-to-add', { added: 0, already, ...unresolved })
    return { op, contentIds: resolved.contentIds, unresolved }
  }
  return { op }
}

function planTrack(probe: Db, xml: string | null, op: TrackOp, find: FindOptions): Plan {
  const notices: RekordboxQueueNotice[] = []
  const finish = (applied: boolean): Plan => ({ outcome: { id: op.id, applied, notices } })
  const resolved = resolveTracks(probe, [{ contentId: op.contentId, paths: [op.path] }], find)
  if (resolved.ambiguous > 0) {
    notices.push({ code: 'ambiguous', track: op.label })
    return finish(false)
  }
  const entry = resolved.contentIds[0]
  if (!entry && op.wanted.length === 0) return finish(true)
  if (!entry && (!op.facts || !existsSync(op.path))) {
    notices.push({ code: op.facts ? 'file-missing' : 'not-added', track: op.label })
    return finish(false)
  }
  const changed = (pid: string): boolean =>
    xml !== null && op.stamps[pid] !== undefined && nodeTimestamp(xml, pid) !== op.stamps[pid]
  const current = entry ? trackPlaylists(probe, entry) : []
  const targetIds = [...new Set(op.wanted.flatMap((t) => (t.id ? [t.id] : [])))]
  const typed = [...new Set(op.wanted.flatMap((t) => (t.id ? [] : [t.name.trim()])))].filter(
    (n) => n !== '',
  )
  const existing = typed.flatMap((n) => {
    const pid = liveRootPlaylist(probe, n)
    return pid ? [pid] : []
  })
  const names = typed.filter((n) => !liveRootPlaylist(probe, n))
  const wantedIds = [...new Set([...targetIds, ...existing])]
  const adds: string[] = []
  for (const pid of existing) if (!current.includes(pid) && !targetIds.includes(pid)) adds.push(pid)
  for (const pid of targetIds) {
    if (current.includes(pid)) continue
    const playlist = op.wanted.find((t) => t.id === pid)?.name ?? pid
    if (nodeAttribute(probe, pid) !== 0)
      notices.push({ code: 'playlist-gone', track: op.label, playlist })
    else if (changed(pid)) notices.push({ code: 'playlist-changed', track: op.label, playlist })
    else adds.push(pid)
  }
  const removes: string[] = []
  for (const pid of current) {
    if (wantedIds.includes(pid)) continue
    if (!op.known.includes(pid) || changed(pid))
      notices.push({
        code: 'playlist-changed',
        track: op.label,
        playlist: playlistName(probe, pid),
      })
    else removes.push(pid)
  }
  if (adds.length === 0 && removes.length === 0 && names.length === 0) return finish(!!entry)
  return { op, track: { entry, adds, removes, names, notices } }
}

function planOp(probe: Db, xml: string | null, op: QueueOp, find: FindOptions): Plan {
  return op.kind === 'track' ? planTrack(probe, xml, op, find) : planEdit(probe, xml, op, find)
}

function freeId(draft: XmlDraft): string {
  for (;;) {
    const id = randomPlaylistId()
    if (!draft.taken.has(hexId(id))) return id
  }
}

function writeEdit(db: Db, draft: XmlDraft, planned: Planned, now: Date): OpOutcome {
  const op = planned.op as EditOp
  const { edit } = op
  const ctx = { now, newPlaylistId: () => freeId(draft) }
  const done = (extra: Partial<OpOutcome> = {}): OpOutcome => ({
    id: op.id,
    applied: true,
    notices: [],
    ...extra,
  })
  if (edit.kind === 'add') {
    const counts = addToPlaylist(db, edit.playlistId, planned.contentIds ?? [], ctx)
    bumpNode(draft, edit.playlistId)
    return done({ report: { ...counts, notInCollection: 0, ambiguous: 0, ...planned.unresolved } })
  }
  if (edit.kind === 'move') {
    moveInPlaylist(db, edit.playlistId, edit.linkIds, edit.beforeLinkId, ctx)
    bumpNode(draft, edit.playlistId)
    return done()
  }
  if (edit.kind === 'remove') {
    removeFromPlaylist(db, edit.playlistId, edit.linkIds, ctx)
    bumpNode(draft, edit.playlistId)
    return done()
  }
  if (edit.kind === 'insertSeparator') {
    insertSeparator(db, edit.playlistId, edit.beforeLinkId, ctx)
    bumpNode(draft, edit.playlistId)
    return done()
  }
  if (edit.kind === 'create') {
    const created = createNode(db, edit.parentId, edit.name, edit.folder, ctx)
    if (draft.xml !== null)
      draft.xml = withPlaylistNode(draft.xml, {
        id: created.id,
        parentId: edit.parentId,
        attribute: created.attribute,
        timestamp: draft.now,
      })
    draft.taken.add(hexId(created.id))
    return done({ createdId: created.id })
  }
  if (edit.kind === 'rename') {
    renameNode(db, edit.playlistId, edit.name, ctx)
    bumpNode(draft, edit.playlistId)
    return done()
  }
  const gone = deleteNode(db, edit.playlistId, ctx)
  if (draft.xml !== null) draft.xml = withoutNodes(draft.xml, gone)
  return done()
}

function liveRootPlaylist(db: Db, name: string): string | undefined {
  const row = db
    .prepare(
      `SELECT ID FROM djmdPlaylist WHERE Name = ? AND ParentID = 'root' AND Attribute = 0
        AND coalesce(rb_local_deleted, 0) = 0 ORDER BY Seq LIMIT 1`,
    )
    .get(name) as { ID: string } | undefined
  return row?.ID
}

function writeTrack(db: Db, draft: XmlDraft, planned: Planned, now: Date): OpOutcome {
  const op = planned.op as TrackOp
  const plan = planned.track as NonNullable<Planned['track']>
  const ctx = { now, newPlaylistId: () => freeId(draft) }
  const entry = plan.entry ?? insertContent(db, op.facts as ContentFacts, { now })
  const adds = [...plan.adds]
  for (const name of plan.names) {
    let pid = draft.created.get(name) ?? liveRootPlaylist(db, name)
    if (!pid) {
      pid = createNode(db, 'root', name, false, ctx).id
      if (draft.xml !== null)
        draft.xml = withPlaylistNode(draft.xml, {
          id: pid,
          parentId: 'root',
          attribute: 0,
          timestamp: draft.now,
        })
      draft.taken.add(hexId(pid))
    }
    draft.created.set(name, pid)
    if (!trackPlaylists(db, entry).includes(pid)) adds.push(pid)
  }
  for (const pid of adds) {
    addToPlaylist(db, pid, [entry], ctx)
    bumpNode(draft, pid)
  }
  for (const pid of plan.removes) {
    removeTrackFromPlaylist(db, pid, entry, ctx)
    bumpNode(draft, pid)
  }
  return { id: op.id, applied: true, notices: plan.notices, contentId: entry }
}

function writeOp(db: Db, draft: XmlDraft, planned: Planned, now: Date): OpOutcome {
  return planned.op.kind === 'track'
    ? writeTrack(db, draft, planned, now)
    : writeEdit(db, draft, planned, now)
}

function needsNode(planned: Planned): boolean {
  if (planned.op.kind === 'track') return (planned.track?.names.length ?? 0) > 0
  return planned.op.edit.kind === 'create'
}

export async function applyRekordboxBatch(
  collectionPath: string,
  ops: QueueOp[],
  deps: PlaylistWriteDeps,
): Promise<BatchResult> {
  if (!collectionPath) return { ok: false, reason: 'unreadable' }
  const xmlPath = playlistXmlPath(collectionPath)
  const hasXml = existsSync(xmlPath)
  const outcomes = new Map<string, OpOutcome>()
  const planned: Planned[] = []
  const probe = openRekordboxDb(collectionPath, { readonly: true })
  if (!probe) return { ok: false, reason: 'unreadable' }
  try {
    const current = hasXml ? await readFile(xmlPath, 'utf8') : null
    for (const op of ops) {
      const plan = planOp(probe, current, op, deps)
      if ('outcome' in plan) outcomes.set(op.id, plan.outcome)
      else planned.push(plan)
    }
  } finally {
    probe.close()
  }
  const inOrder = (): OpOutcome[] => ops.map((op) => outcomes.get(op.id) as OpOutcome)
  if (planned.length === 0) return { ok: true, wrote: false, outcomes: inOrder() }

  if (hasXml && planned.some(needsNode) && !(await xmlTakesNode(xmlPath)))
    return { ok: false, reason: 'unreadable' }

  if (!(await deps.ensureClosed())) return { ok: false, reason: 'cancelled' }

  const touched = hasXml ? [collectionPath, xmlPath] : [collectionPath]
  let xml: string | null = null
  try {
    checkpoint(collectionPath)
    for (const path of touched) {
      await deps.sessionBackup(path)
      await writeBackup(path, `${path}${BACKUP_SUFFIX}`)
    }
    if (hasXml) xml = await readFile(xmlPath, 'utf8')
  } catch (err) {
    return { ok: false, reason: isReadOnly(err) ? 'read-only' : 'backup-failed' }
  }

  if (await isRekordboxRunning()) return { ok: false, reason: 'rekordbox-running' }

  const db = openRekordboxDb(collectionPath)
  if (!db) return { ok: false, reason: 'unreadable' }
  const stillPlanned: Planned[] = []
  for (const p of planned) {
    if (p.op.kind === 'track') {
      const again = planTrack(db, xml, p.op, deps)
      if ('outcome' in again) outcomes.set(p.op.id, again.outcome)
      else stillPlanned.push(again)
      continue
    }
    const changed = changedOutcome(db, xml, p.op)
    if (changed) outcomes.set(p.op.id, changed)
    else stillPlanned.push(p)
  }
  if (stillPlanned.length === 0) {
    db.close()
    return { ok: true, wrote: false, outcomes: inOrder() }
  }
  const now = deps.now?.() ?? new Date()
  const draft: XmlDraft = {
    xml,
    taken: xml === null ? new Set<string>() : xmlNodeIds(xml),
    now: now.getTime(),
    created: new Map<string, string>(),
  }
  let xmlWritten = false
  let anyApplied = false
  try {
    db.exec('BEGIN')
    for (const p of [...stillPlanned].sort((a, b) => opRank(a.op) - opRank(b.op))) {
      const saved = {
        xml: draft.xml,
        taken: new Set(draft.taken),
        created: new Map(draft.created),
      }
      db.exec('SAVEPOINT surco_op')
      try {
        const outcome = writeOp(db, draft, p, now)
        outcomes.set(p.op.id, outcome)
        if (outcome.applied) anyApplied = true
        db.exec('RELEASE surco_op')
      } catch (err) {
        if (!(err instanceof EditRefused)) throw err
        db.exec('ROLLBACK TO surco_op')
        db.exec('RELEASE surco_op')
        Object.assign(draft, saved)
        outcomes.set(p.op.id, { id: p.op.id, applied: false, reason: err.reason, notices: [] })
      }
    }
    deps.onWrite?.()
    if (draft.xml !== null && draft.xml !== xml) {
      await (deps.writeXml ?? replaceFile)(xmlPath, draft.xml)
      xmlWritten = true
    }
    db.exec('COMMIT')
  } catch (err) {
    const known = rollback(db, deps.onRollback)
    db.close()
    if (xmlWritten) await restoreFile(xmlPath)
    if (!known && !(await restoreCollection(collectionPath)))
      return { ok: false, reason: 'write-unknown' }
    if (isReadOnly(err)) return { ok: false, reason: 'read-only' }
    log.warn(`rekordbox batch failed: ${String(err)}`)
    return { ok: false, reason: 'write-failed' }
  }
  db.close()
  return { ok: true, wrote: anyApplied, outcomes: inOrder() }
}

export async function editRekordboxPlaylist(
  collectionPath: string,
  edit: RekordboxPlaylistEdit,
  deps: PlaylistWriteDeps,
): Promise<RekordboxEditResult> {
  const result = await applyRekordboxBatch(
    collectionPath,
    [{ id: 'edit', kind: 'edit', edit, stamps: {} }],
    deps,
  )
  if (!result.ok) return { applied: false, reason: result.reason }
  return editResultOfOutcome(result.outcomes[0])
}
