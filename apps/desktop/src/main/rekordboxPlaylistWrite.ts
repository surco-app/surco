import { existsSync } from 'node:fs'
import { chmod, copyFile, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import log from 'electron-log/main'
import type {
  PlaylistAddReport,
  RekordboxEditRefusal,
  RekordboxEditResult,
  RekordboxPlaylistEdit,
} from '../shared/types'
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
  playlistContents,
  randomPlaylistId,
  removeFromPlaylist,
  renameNode,
  resolveTracks,
} from './rekordboxPlaylistEdit'
import { isRekordboxRunning } from './rekordboxProcess'
import {
  type BatchResult,
  bumpNode,
  type EditOp,
  type OpOutcome,
  opRank,
  type QueueOp,
  type XmlDraft,
} from './rekordboxQueueOps'
import { writeBackup } from './rekordboxSessionBackup'

// Writes one organising edit into the user's rekordbox collection, the one library they
// cannot rebuild. Same bargain as the repoint (rekordboxLibrary.ts): the edit is planned
// on a read-only handle first, so an edit with nothing to write (or one the XML cannot
// take) never asks the user to close rekordbox; rekordbox must be closed (asked once, then
// checked again right before the write); there is a complete copy for the session and one
// for this write before anything changes; and the edit runs in one transaction that also
// covers the XML node, written just before the commit. A failure is undone by SQLite's own
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

function refuse(reason: RekordboxEditRefusal, report?: PlaylistAddReport): RekordboxEditResult {
  return report ? { applied: false, reason, report } : { applied: false, reason }
}

type Db = NonNullable<ReturnType<typeof openRekordboxDb>>

interface Planned {
  op: QueueOp
  contentIds?: string[]
  unresolved?: { notInCollection: number; ambiguous: number }
}

type Plan = Planned | { outcome: OpOutcome }

function playlistName(db: Db, id: string): string {
  const row = db.prepare('SELECT Name FROM djmdPlaylist WHERE ID = ?').get(id) as
    | { Name: string }
    | undefined
  return row?.Name ?? id
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
  for (const [playlistId, stamp] of Object.entries(op.stamps)) {
    if (xml !== null && nodeTimestamp(xml, playlistId) !== stamp)
      return {
        outcome: {
          id: op.id,
          applied: false,
          reason: 'stale',
          notices: [{ code: 'edit-changed', playlist: playlistName(probe, playlistId) }],
        },
      }
  }
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

function planOp(probe: Db, xml: string | null, op: QueueOp, find: FindOptions): Plan {
  return planEdit(probe, xml, op, find)
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

function writeOp(db: Db, draft: XmlDraft, planned: Planned, now: Date): OpOutcome {
  return writeEdit(db, draft, planned, now)
}

function needsNode(planned: Planned): boolean {
  return planned.op.kind === 'edit' && planned.op.edit.kind === 'create'
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
  const now = deps.now?.() ?? new Date()
  const draft: XmlDraft = {
    xml,
    taken: xml === null ? new Set<string>() : xmlNodeIds(xml),
    now: now.getTime(),
  }
  let xmlWritten = false
  try {
    db.exec('BEGIN')
    for (const p of [...planned].sort((a, b) => opRank(a.op) - opRank(b.op))) {
      const saved = draft.xml
      db.exec('SAVEPOINT surco_op')
      try {
        outcomes.set(p.op.id, writeOp(db, draft, p, now))
        db.exec('RELEASE surco_op')
      } catch (err) {
        if (!(err instanceof EditRefused)) throw err
        db.exec('ROLLBACK TO surco_op')
        db.exec('RELEASE surco_op')
        draft.xml = saved
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
  return { ok: true, wrote: true, outcomes: inOrder() }
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
  if (!result.ok) return refuse(result.reason)
  const [outcome] = result.outcomes
  if (!outcome.applied) return refuse(outcome.reason ?? 'write-failed', outcome.report)
  if (outcome.report) return { applied: true, report: outcome.report }
  return outcome.createdId ? { applied: true, createdId: outcome.createdId } : { applied: true }
}
