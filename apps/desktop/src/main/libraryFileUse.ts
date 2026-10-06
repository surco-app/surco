import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadSqlJs } from './engine'
import { absolute } from './engineRepoint'
import { toNmlLocation } from './ffmpeg'
import { type PathMatchOptions, pathKey } from './libraryPathKey'
import { findTrackByPath, openRekordboxDb } from './rekordboxDb'
import { findEntries } from './traktorNml'

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
