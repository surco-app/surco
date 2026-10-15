import { ipcMain } from 'electron'
import log from 'electron-log/main'
import { openRekordboxDb } from './rekordboxDb'
import { readRekordboxPlaylist, readRekordboxTree } from './rekordboxPlaylists'

// Opens the collection read-only for one read and always closes it: rekordbox may be
// running, and a handle left open is a lock it never asked for. Every way the read can
// fail — no collection, not decryptable, a column a future rekordbox renamed — answers
// with the fallback, because the renderer shows "no rekordbox" for all of them and a
// throw would only reach it as an unhandled IPC rejection.
export function withCollection<T>(
  path: string,
  read: (db: NonNullable<ReturnType<typeof openRekordboxDb>>) => T,
  fallback: T,
): T {
  if (!path) return fallback
  const db = openRekordboxDb(path, { readonly: true })
  if (!db) return fallback
  try {
    return read(db)
  } catch (err) {
    log.warn(`rekordbox playlist read failed: ${String(err)}`)
    return fallback
  } finally {
    db.close()
  }
}

// The collection path is resolved on every call, not captured once: the user can change
// the override in Settings while Surco runs.
export function registerRekordboxPlaylistsIpc(collection: () => string): void {
  ipcMain.handle('rekordbox:available', () => withCollection(collection(), () => true, false))
  ipcMain.handle('rekordbox:tree', () => withCollection(collection(), readRekordboxTree, []))
  ipcMain.handle('rekordbox:playlist', (_e, id: string) =>
    withCollection(collection(), (db) => readRekordboxPlaylist(db, id), []),
  )
}
