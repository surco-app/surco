import { existsSync } from 'node:fs'
import { ipcMain } from 'electron'
import log from 'electron-log/main'
import { openRekordboxDb } from './rekordboxDb'
import { readRekordboxPlaylist, readRekordboxTree } from './rekordboxPlaylists'

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
): T {
  if (!path) return fallback
  const db = openRekordboxDb(path, { readonly: true })
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

// The collection path is resolved on every call, not captured once: the user can change
// the override in Settings while Surco runs.
export function registerRekordboxPlaylistsIpc(collection: () => string): void {
  ipcMain.handle('rekordbox:available', () => collectionAvailable(collection()))
  ipcMain.handle('rekordbox:tree', () => withCollection(collection(), readRekordboxTree, []))
  ipcMain.handle('rekordbox:playlist', (_e, id: string) =>
    withCollection(collection(), (db) => readRekordboxPlaylist(db, id), []),
  )
}
