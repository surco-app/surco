import { existsSync } from 'node:fs'
import { copyFile, readFile, rename, stat, writeFile } from 'node:fs/promises'
import log from 'electron-log/main'
import type {
  PlaylistAddReport,
  RekordboxEditRefusal,
  RekordboxEditResult,
  RekordboxPlaylistEdit,
} from '../shared/types'
import { type FindOptions, openRekordboxDb } from './rekordboxDb'
import { hexId, playlistXmlPath, withPlaylistNode, xmlNodeIds } from './rekordboxMasterXml'
import {
  addToPlaylist,
  createNode,
  EditRefused,
  editProblem,
  insertSeparator,
  moveChangesOrder,
  moveInPlaylist,
  playlistContents,
  randomPlaylistId,
  removeFromPlaylist,
  resolveTracks,
} from './rekordboxPlaylistEdit'
import { isRekordboxRunning } from './rekordboxProcess'

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
  writeXml?: (path: string, text: string) => Promise<void>
}

// Written beside and renamed over, so rekordbox never finds a half-written file.
async function replaceFile(path: string, text: string): Promise<void> {
  const temp = `${path}.surco-tmp`
  await writeFile(temp, text, 'utf8')
  await rename(temp, path)
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
// The text edit refuses a layout it would have to guess at; the ID is a placeholder, only
// the layout is being checked.
async function xmlTakesNode(xmlPath: string, parentId: string): Promise<boolean> {
  try {
    withPlaylistNode(await readFile(xmlPath, 'utf8'), {
      id: '100',
      parentId,
      attribute: 0,
      timestamp: 0,
    })
    return true
  } catch {
    return false
  }
}

async function restoreFile(path: string): Promise<void> {
  try {
    await copyFile(`${path}${BACKUP_SUFFIX}`, path)
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
function rollback(db: NonNullable<ReturnType<typeof openRekordboxDb>>): boolean {
  try {
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

export async function editRekordboxPlaylist(
  collectionPath: string,
  edit: RekordboxPlaylistEdit,
  deps: PlaylistWriteDeps,
): Promise<RekordboxEditResult> {
  if (!collectionPath) return refuse('unreadable')

  const probe = openRekordboxDb(collectionPath, { readonly: true })
  if (!probe) return refuse('unreadable')
  let contentIds: string[] = []
  let unresolved = { notInCollection: 0, ambiguous: 0 }
  try {
    const problem = editProblem(probe, edit)
    if (problem) return refuse(problem)
    // Already in the order asked for: the list shows it, and there is nothing to write.
    if (
      edit.kind === 'move' &&
      !moveChangesOrder(probe, edit.playlistId, edit.linkIds, edit.beforeLinkId)
    )
      return { applied: true }
    if (edit.kind === 'add') {
      const resolved = resolveTracks(probe, edit.tracks, deps)
      contentIds = resolved.contentIds
      unresolved = { notInCollection: resolved.notInCollection, ambiguous: resolved.ambiguous }
      const present = playlistContents(probe, edit.playlistId)
      const already = contentIds.filter((id) => present.has(id)).length
      if (already === contentIds.length)
        return refuse('nothing-to-add', { added: 0, already, ...unresolved })
    }
  } finally {
    probe.close()
  }

  const xmlPath = playlistXmlPath(collectionPath)
  // Only a creation touches the XML; a file rekordbox never wrote (rekordbox 5) is left
  // absent rather than invented.
  const withXml = edit.kind === 'create' && existsSync(xmlPath)
  if (withXml && !(await xmlTakesNode(xmlPath, edit.parentId))) return refuse('unreadable')

  if (!(await deps.ensureClosed())) return refuse('cancelled')

  const touched = withXml ? [collectionPath, xmlPath] : [collectionPath]
  let xml: string | null = null
  try {
    checkpoint(collectionPath)
    for (const path of touched) {
      // The session's copy first: it must describe the collection before Surco's first
      // edit. Then the copy a failed write is restored from.
      await deps.sessionBackup(path)
      await copyFile(path, `${path}${BACKUP_SUFFIX}`)
    }
    // Read now, so nothing waits between the second check below and the transaction.
    if (withXml) xml = await readFile(xmlPath, 'utf8')
  } catch (err) {
    return refuse(isReadOnly(err) ? 'read-only' : 'backup-failed')
  }

  // Second check, right before the write: the user can launch rekordbox again after the
  // dialog closed it.
  if (await isRekordboxRunning()) return refuse('rekordbox-running')

  const db = openRekordboxDb(collectionPath)
  if (!db) return refuse('unreadable')
  const now = deps.now?.() ?? new Date()
  const taken = xml === null ? new Set<string>() : xmlNodeIds(xml)
  const freeId = (): string => {
    for (;;) {
      const id = randomPlaylistId()
      if (!taken.has(hexId(id))) return id
    }
  }
  let created: { id: string; attribute: 0 | 1 } | undefined
  let counts = { added: 0, already: 0 }
  let xmlWritten = false
  try {
    db.exec('BEGIN')
    if (edit.kind === 'add') counts = addToPlaylist(db, edit.playlistId, contentIds, { now })
    else if (edit.kind === 'move')
      moveInPlaylist(db, edit.playlistId, edit.linkIds, edit.beforeLinkId, { now })
    else if (edit.kind === 'remove') removeFromPlaylist(db, edit.playlistId, edit.linkIds, { now })
    else if (edit.kind === 'insertSeparator')
      insertSeparator(db, edit.playlistId, edit.beforeLinkId, { now })
    else
      created = createNode(db, edit.parentId, edit.name, edit.folder, {
        now,
        newPlaylistId: freeId,
      })
    // After the statements, so a test can fail the write once it really changed something.
    deps.onWrite?.()
    // The node goes in before the row commits: an XML that cannot be written is then a
    // rollback, and the row never exists without its node, whoever else has the file open.
    if (created && xml !== null && edit.kind === 'create') {
      const next = withPlaylistNode(xml, {
        id: created.id,
        parentId: edit.parentId,
        attribute: created.attribute,
        timestamp: now.getTime(),
      })
      await (deps.writeXml ?? replaceFile)(xmlPath, next)
      xmlWritten = true
    }
    db.exec('COMMIT')
  } catch (err) {
    const known = rollback(db)
    db.close()
    if (xmlWritten) await restoreFile(xmlPath)
    if (!known) await restoreCollection(collectionPath)
    // Refused inside the transaction: it rolled back, nothing was written.
    if (err instanceof EditRefused) return refuse(err.reason)
    if (isReadOnly(err)) return refuse('read-only')
    log.warn(`rekordbox playlist edit failed: ${String(err)}`)
    return refuse('write-failed')
  }
  db.close()

  if (edit.kind === 'add') return { applied: true, report: { ...counts, ...unresolved } }
  return created ? { applied: true, createdId: created.id } : { applied: true }
}
