import { existsSync, realpathSync } from 'node:fs'
import log from 'electron-log/main'
import type { DjReadMain } from '../shared/djApi'
import { mediaPathFromUrl } from '../shared/media'
import {
  type EngineDb,
  engineDatabasePath,
  openEngineDb,
  readEngineMembership,
  readEnginePlaylist,
  readEngineRecentCount,
  readEngineTrackCount,
  readEngineTree,
} from './enginePlaylists'
import { pathKey } from './libraryPathKey'

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

export function engineRead(libraryDir: () => string, host: EnginePlaylistsHost): DjReadMain {
  return {
    available: () => {
      const dir = libraryDir()
      return dir !== '' && existsSync(engineDatabasePath(dir))
    },
    tree: () => withEngineLibrary(libraryDir(), readEngineTree, []),
    recentCount: () => withEngineLibrary(libraryDir(), (db) => readEngineRecentCount(db), 0),
    trackCount: () => withEngineLibrary(libraryDir(), readEngineTrackCount, 0),
    playlist: (id: string) => {
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
    },
    membership: (paths: string[]) => {
      const dir = libraryDir()
      const key = pathKey({ realPath: (p: string) => realpathSync(p) })
      return withEngineLibrary(dir, (db) => readEngineMembership(db, dir, paths, key), {})
    },
  }
}
