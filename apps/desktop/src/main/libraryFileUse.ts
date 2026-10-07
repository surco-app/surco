import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LibraryCopyInfo, LibraryCopyPresence } from '../shared/types'
import { loadSqlJs } from './engine'
import { absolute } from './engineRepoint'
import { toNmlLocation } from './ffmpeg'
import { type PathMatchOptions, pathKey } from './libraryPathKey'
import { findTrackByPath, isAmbiguous, openRekordboxDb } from './rekordboxDb'
import { findEntries, nmlCopyInfo } from './traktorNml'

// Each library's location, or '' when its sync is off.
export interface SyncedLibraries {
  rekordbox: string
  engine: string
  traktor: string
}

// Read only, and it throws when a library it should look in cannot be read: the caller
// keeps the file then, since that library may still use it.
export async function usedByDjLibrary(
  path: string,
  libraries: SyncedLibraries,
  options: PathMatchOptions = {},
): Promise<boolean> {
  if (libraries.rekordbox) {
    const db = openRekordboxDb(libraries.rekordbox)
    if (!db) throw new Error(`rekordbox collection unreadable: ${libraries.rekordbox}`)
    try {
      if (findTrackByPath(db, path, options) !== null) return true
    } finally {
      db.close()
    }
  }
  if (libraries.engine) {
    const SQL = await loadSqlJs()
    const db = new SQL.Database(await readFile(join(libraries.engine, 'Database2', 'm.db')))
    try {
      const key = pathKey(options)
      const target = key(path.normalize('NFC'))
      const rows = db.exec('SELECT path FROM Track')[0]?.values ?? []
      if (rows.some(([stored]) => key(absolute(libraries.engine, String(stored))) === target))
        return true
    } finally {
      db.close()
    }
  }
  if (libraries.traktor) {
    const nml = await readFile(libraries.traktor, 'utf8')
    const at = toNmlLocation(path)
    const same = (a: string, b: string) => a.normalize('NFC') === b.normalize('NFC')
    // An empty volume is the boot disk, which Traktor stores under its own name.
    if (
      findEntries(nml).some(
        (e) =>
          same(e.dir, at.dir) && same(e.file, at.file) && (!at.volume || same(e.volume, at.volume)),
      )
    )
      return true
  }
  return false
}

const LIVE = '(rb_local_deleted IS NULL OR rb_local_deleted = 0)'

function rekordboxInfo(
  collection: string,
  paths: string[],
  options: PathMatchOptions,
): LibraryCopyPresence[] {
  const db = openRekordboxDb(collection, { readonly: true })
  if (!db) throw new Error(`rekordbox collection unreadable: ${collection}`)
  try {
    return paths.map((path) => {
      const match = findTrackByPath(db, path, options)
      if (match === null || isAmbiguous(match)) return null
      const count = (sql: string) => (db.prepare(sql).get(match.id) as { n: number }).n
      return {
        cues: count(`SELECT count(*) AS n FROM djmdCue WHERE ContentID = ? AND ${LIVE}`),
        playlists: count(
          `SELECT count(DISTINCT PlaylistID) AS n FROM djmdSongPlaylist WHERE ContentID = ? AND ${LIVE}`,
        ),
      }
    })
  } finally {
    db.close()
  }
}

async function engineInfo(
  libraryDir: string,
  paths: string[],
  options: PathMatchOptions,
): Promise<LibraryCopyPresence[]> {
  const SQL = await loadSqlJs()
  const db = new SQL.Database(await readFile(join(libraryDir, 'Database2', 'm.db')))
  try {
    const key = pathKey(options)
    const rows = (db.exec('SELECT id, path FROM Track')[0]?.values ?? []).map(([id, stored]) => ({
      id: Number(id),
      key: key(absolute(libraryDir, String(stored))),
    }))
    return paths.map((path) => {
      const target = key(path.normalize('NFC'))
      const found = rows.filter((r) => r.key === target)
      if (found.length !== 1) return null
      const lists = db.exec('SELECT count(DISTINCT listId) FROM PlaylistEntity WHERE trackId = ?', [
        found[0].id,
      ])
      return { playlists: Number(lists[0]?.values[0][0] ?? 0) }
    })
  } finally {
    db.close()
  }
}

// Read only, for the duplicate detail: what each enabled library holds for each copy. A
// library that cannot be read is left out rather than reported, since this only informs.
export async function libraryCopyInfo(
  paths: string[],
  libraries: SyncedLibraries,
  options: PathMatchOptions = {},
): Promise<Record<string, LibraryCopyInfo>> {
  const info: Record<string, LibraryCopyInfo> = Object.fromEntries(paths.map((p) => [p, {}]))
  const fill = (library: keyof LibraryCopyInfo, found: LibraryCopyPresence[]) =>
    paths.forEach((p, i) => {
      info[p][library] = found[i]
    })
  if (libraries.rekordbox) {
    try {
      fill('rekordbox', rekordboxInfo(libraries.rekordbox, paths, options))
    } catch {}
  }
  if (libraries.engine) {
    try {
      fill('engine', await engineInfo(libraries.engine, paths, options))
    } catch {}
  }
  if (libraries.traktor) {
    try {
      const nml = await readFile(libraries.traktor, 'utf8')
      fill(
        'traktor',
        paths.map((p) => nmlCopyInfo(nml, toNmlLocation(p))),
      )
    } catch {}
  }
  return info
}
