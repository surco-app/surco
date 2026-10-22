import { existsSync } from 'node:fs'
import { ipcMain } from 'electron'
import log from 'electron-log/main'
import { mediaPathFromUrl } from '../shared/media'
import {
  type EngineDb,
  engineDatabasePath,
  openEngineDb,
  readEnginePlaylist,
  readEngineTree,
} from './enginePlaylists'

export function withEngineLibrary<T>(
  libraryDir: string,
  read: (db: EngineDb) => T,
  fallback: T,
): T {
  const db = openEngineDb(libraryDir)
  if (!db) return fallback
  try {
    return read(db)
  } catch (err) {
    log.warn(`Engine DJ playlist read failed: ${String(err)}`)
    throw err
  } finally {
    db.close()
  }
}

export interface EnginePlaylistsHost {
  artDir: () => string
  allowMedia?: (paths: string[]) => void
}

export function registerEnginePlaylistsIpc(
  libraryDir: () => string,
  host: EnginePlaylistsHost,
): void {
  ipcMain.handle('engine:available', () => {
    const dir = libraryDir()
    return dir !== '' && existsSync(engineDatabasePath(dir))
  })
  ipcMain.handle('engine:tree', () => withEngineLibrary(libraryDir(), readEngineTree, []))
  ipcMain.handle('engine:playlist', (_e, id: string) => {
    const dir = libraryDir()
    const entries = withEngineLibrary(
      dir,
      (db) => readEnginePlaylist(db, dir, id, host.artDir()),
      [],
    )
    host.allowMedia?.(
      entries.flatMap((e) => [
        ...(e.path ? [e.path] : []),
        ...(e.preview?.coverUrl ? [mediaPathFromUrl(e.preview.coverUrl)] : []),
      ]),
    )
    return entries
  })
}
