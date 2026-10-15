import { existsSync } from 'node:fs'
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
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
// on a read-only handle first, so an edit with nothing to write never asks the user to
// close rekordbox; rekordbox must be closed (asked once, then checked again right before
// the write); there is a copy for the session and one for this write before anything
// changes; the edit runs in one transaction; and any failure after the first statement
// puts every touched file back from its copy.

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
// complete backup; it changes nothing rekordbox would see.
function checkpoint(collectionPath: string): void {
  const db = openRekordboxDb(collectionPath)
  if (!db) throw new Error('rekordbox collection could not be opened')
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    db.close()
  }
}

const isReadOnly = (err: unknown): boolean =>
  String((err as { code?: unknown })?.code).startsWith('SQLITE_READONLY')

async function restore(paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      await copyFile(`${path}${BACKUP_SUFFIX}`, path)
    } catch {
      // The copy stays on disk under its own name for the user to restore by hand.
    }
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

  if (!(await deps.ensureClosed())) return refuse('cancelled')

  const xmlPath = playlistXmlPath(collectionPath)
  // Only a creation touches the XML; a file rekordbox never wrote (rekordbox 5) is left
  // absent rather than invented.
  const touched =
    edit.kind === 'create' && existsSync(xmlPath) ? [collectionPath, xmlPath] : [collectionPath]
  try {
    checkpoint(collectionPath)
    for (const path of touched) {
      // The session's copy first: it must describe the collection before Surco's first
      // edit. Then the copy a failed write is restored from.
      await deps.sessionBackup(path)
      await copyFile(path, `${path}${BACKUP_SUFFIX}`)
    }
  } catch (err) {
    return refuse(isReadOnly(err) ? 'read-only' : 'backup-failed')
  }

  // Second check, right before the write: the user can launch rekordbox again after the
  // dialog closed it.
  if (await isRekordboxRunning()) return refuse('rekordbox-running')

  const db = openRekordboxDb(collectionPath)
  if (!db) return refuse('unreadable')
  const now = deps.now?.() ?? new Date()
  let created: { id: string; attribute: 0 | 1 } | undefined
  let counts = { added: 0, already: 0 }
  try {
    const taken = touched.includes(xmlPath)
      ? xmlNodeIds(await readFile(xmlPath, 'utf8'))
      : new Set<string>()
    const freeId = (): string => {
      for (;;) {
        const id = randomPlaylistId()
        if (!taken.has(hexId(id))) return id
      }
    }
    db.transaction(() => {
      if (edit.kind === 'add') counts = addToPlaylist(db, edit.playlistId, contentIds, { now })
      else if (edit.kind === 'move')
        moveInPlaylist(db, edit.playlistId, edit.linkIds, edit.beforeLinkId, { now })
      else if (edit.kind === 'remove')
        removeFromPlaylist(db, edit.playlistId, edit.linkIds, { now })
      else if (edit.kind === 'insertSeparator')
        insertSeparator(db, edit.playlistId, edit.beforeLinkId, { now })
      else
        created = createNode(db, edit.parentId, edit.name, edit.folder, {
          now,
          newPlaylistId: freeId,
        })
      // After the statements, so a test can fail the write once it really changed something.
      deps.onWrite?.()
    })()
  } catch (err) {
    db.close()
    // Refused inside the transaction: it rolled back, nothing was written.
    if (err instanceof EditRefused) return refuse(err.reason)
    if (isReadOnly(err)) return refuse('read-only')
    log.warn(`rekordbox playlist edit failed: ${String(err)}`)
    await restore(touched)
    return refuse('write-failed')
  }
  db.close()

  if (created && touched.includes(xmlPath)) {
    try {
      const xml = await readFile(xmlPath, 'utf8')
      const next = withPlaylistNode(xml, {
        id: created.id,
        parentId: edit.kind === 'create' ? edit.parentId : 'root',
        attribute: created.attribute,
        timestamp: now.getTime(),
      })
      await (deps.writeXml ?? replaceFile)(xmlPath, next)
    } catch (err) {
      log.warn(`rekordbox playlist XML write failed: ${String(err)}`)
      await restore(touched)
      return refuse('write-failed')
    }
  }

  if (edit.kind === 'add') return { applied: true, report: { ...counts, ...unresolved } }
  return created ? { applied: true, createdId: created.id } : { applied: true }
}
