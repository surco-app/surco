import { existsSync } from 'node:fs'
import log from 'electron-log/main'
import type { DjReadMain } from '../shared/djApi'
import { mediaPathFromUrl } from '../shared/media'
import { type EngineDb, engineDatabasePath, openEngineDb } from './enginePlaylists'
import { readEngine } from './worker'

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
    tree: () => readEngine(libraryDir(), 'tree', undefined),
    recentCount: () => readEngine(libraryDir(), 'recentCount', undefined),
    trackCount: () => readEngine(libraryDir(), 'trackCount', undefined),
    playlist: async (id: string) => {
      const entries = await readEngine(libraryDir(), 'playlist', { id, artDir: host.artDir() })
      host.allowMedia?.(
        entries.flatMap((e) => [
          ...(e.path ? [e.path] : []),
          ...(e.preview?.coverUrl ? [mediaPathFromUrl(e.preview.coverUrl)] : []),
        ]),
      )
      return entries
    },
    membership: (paths: string[]) => readEngine(libraryDir(), 'membership', paths),
  }
}
