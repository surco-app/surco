import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { BrowserWindow, ipcMain } from 'electron'
import log from 'electron-log/main'
import { mediaPathFromUrl } from '../shared/media'
import type { RekordboxEditResult, RekordboxPlaylistEdit } from '../shared/types'
import { pathAliasesOf } from './libraryPathKey'
import { serialLibraryFlush } from './libraryTagSync'
import { rekordboxShareDir } from './rekordboxArtwork'
import { openRekordboxDb, rekordboxRawKey } from './rekordboxDb'
import { readNodeStamps } from './rekordboxMasterXml'
import { separatorContent } from './rekordboxPlaylistEdit'
import { readRekordboxPlaylistWithPreview, readRekordboxTree } from './rekordboxPlaylists'
import { type QueueApply, type RekordboxQueue, withoutOp } from './rekordboxQueue'
import { type EditOp, editResultOfOutcome } from './rekordboxQueueOps'
import { stillWaiting } from './rekordboxQueueWatch'

// Opens the collection read-only for one read and always closes it: rekordbox may be
// running, and a handle left open is a lock it never asked for. No collection on this
// machine answers with the fallback, the empty answer. A collection that is there but
// does not read (not decryptable, rekordbox mid-write, a column a future rekordbox
// renamed) throws instead: the renderer's query turns it into "could not read", which
// is not "no playlists", and must not close an open playlist as if it had been deleted.
export function withCollection<T>(
  path: string,
  read: (db: NonNullable<ReturnType<typeof openRekordboxDb>>) => T,
  fallback: T,
  key?: string,
): T {
  if (!path) return fallback
  const db = openRekordboxDb(path, key ? { readonly: true, key } : { readonly: true })
  if (!db) throw new Error('rekordbox collection could not be opened')
  try {
    return read(db)
  } catch (err) {
    log.warn(`rekordbox playlist read failed: ${String(err)}`)
    throw err
  } finally {
    db.close()
  }
}

// Whether to offer rekordbox in the rail. Asked on every focus, so it only looks for the
// file: decrypting it runs the SQLCipher key derivation in the main process, for every
// user with rekordbox installed, each time Surco comes back. A file that is there but
// does not read is offered anyway, and its tree says it could not be read.
export function collectionAvailable(path: string): boolean {
  return path !== '' && existsSync(path)
}

export interface PlaylistEditHost {
  // The "rekordbox is open" dialog, over the window the edit came from.
  ensureClosed: (win: BrowserWindow | null) => Promise<boolean>
  queue: Pick<RekordboxQueue, 'enqueue' | 'apply' | 'drop'>
  onApplied?: (result: QueueApply) => void
  onWaiting?: () => void
  allowMedia?: (paths: string[]) => void
}

function editStamps(collectionPath: string, edit: RekordboxPlaylistEdit): Record<string, number> {
  if (edit.kind === 'create') return {}
  const stamp = readNodeStamps(collectionPath)[edit.playlistId]
  return stamp === undefined ? {} : { [edit.playlistId]: stamp }
}

// The collection path is resolved on every call, not captured once: the user can change
// the override in Settings while Surco runs.
export function registerRekordboxPlaylistsIpc(
  collection: () => string,
  host: PlaylistEditHost,
): void {
  ipcMain.handle('rekordbox:available', () => collectionAvailable(collection()))
  ipcMain.handle('rekordbox:tree', () => withCollection(collection(), readRekordboxTree, []))
  ipcMain.handle('rekordbox:playlist', async (_e, id: string) => {
    const path = collection()
    const key = path ? await rekordboxRawKey(path).catch(() => undefined) : undefined
    const entries = withCollection(
      path,
      (db) => readRekordboxPlaylistWithPreview(db, rekordboxShareDir(path), id),
      [],
      key,
    )
    host.allowMedia?.(
      entries.flatMap((e) => [
        ...(e.path && !e.separator ? [e.path] : []),
        ...(e.preview?.coverUrl ? [mediaPathFromUrl(e.preview.coverUrl)] : []),
      ]),
    )
    return entries
  })
  // Rows dragged out of the list and dropped back in come with the OS's spelling of their
  // files, which may be resolved through the symlinked music folder.
  ipcMain.handle('library:pathAliases', (_e, paths: unknown) =>
    pathAliasesOf(paths, { realPath: (p: string) => realpath(p) }),
  )
  ipcMain.handle('rekordbox:hasSeparator', () =>
    withCollection(collection(), (db) => separatorContent(db) !== null, false),
  )
  // Queued behind any other library write (a conversion's repoint, a review's sync): they
  // touch the same master.db, and the write's transaction spans an await, so two at once
  // would block each other on SQLite's busy timeout.
  ipcMain.handle('rekordbox:edit', (e, edit: RekordboxPlaylistEdit, label?: string) =>
    serialLibraryFlush(async (): Promise<RekordboxEditResult> => {
      const path = collection()
      if (!path) return { applied: false, reason: 'unreadable' }
      const op: EditOp = {
        id: randomUUID(),
        kind: 'edit',
        edit,
        stamps: editStamps(path, edit),
        ...(label ? { label } : {}),
      }
      host.queue.enqueue([op])
      const result = await host.queue.apply(() =>
        host.ensureClosed(BrowserWindow.fromWebContents(e.sender)),
      )
      if (result.status === 'applied') {
        const others = withoutOp(result, op.id)
        if (others.tracks > 0 || others.changes > 0 || others.notices.length > 0)
          host.onApplied?.(others)
      }
      if (stillWaiting(result)) host.onWaiting?.()
      else if (result.status === 'refused') host.queue.drop(op.id)
      if (result.status === 'refused') return { applied: false, reason: result.reason }
      const outcome =
        result.status === 'applied' ? result.outcomes.find((o) => o.id === op.id) : undefined
      return editResultOfOutcome(outcome)
    }),
  )
}
