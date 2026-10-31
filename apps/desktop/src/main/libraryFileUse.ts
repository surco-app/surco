import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { engineContentId } from '../shared/engineContent'
import { traktorContentId } from '../shared/traktorContent'
import type { LibraryCopyInfo, LibraryCopyPresence, LibraryTracks } from '../shared/types'
import { loadSqlJs } from './engine'
import { engineRowFinder } from './engineRepoint'
import { toNmlLocation } from './ffmpeg'
import { type PathMatchOptions, pathKey } from './libraryPathKey'
import { findTrackByPath, isAmbiguous, openRekordboxDb, rekordboxRawKey } from './rekordboxDb'
import { attr, findEntries, type NmlEntry, nmlCopyInfo } from './traktorNml'

// Each library's location, or '' when its sync is off.
export interface SyncedLibraries {
  rekordbox: string
  engine: string
  traktor: string
}

// Read only, and it throws when a library it should look in cannot be read: the caller
// keeps the file then, since that library may still use it.
export function usedByDjLibrary(
  path: string,
  libraries: SyncedLibraries,
  options: PathMatchOptions = {},
): Promise<boolean> {
  return djLibraryFileUse(libraries, options)(path)
}

// The same check for a whole run of files. Each library is read once, when the first file
// reaches it, and the rekordbox key is derived once: a duplicate replace asks per removed
// copy, after it has settled every library, so nothing changes them between two files.
export function djLibraryFileUse(
  libraries: SyncedLibraries,
  options: PathMatchOptions = {},
): (path: string) => Promise<boolean> {
  const key = pathKey(options)
  let rekordboxKey: Promise<string> | undefined
  let engineRows: ReturnType<typeof readEngineRows> | undefined
  let nmlEntries: Promise<NmlEntry[]> | undefined
  return async (path) => {
    if (libraries.rekordbox) {
      rekordboxKey ??= rekordboxRawKey(libraries.rekordbox)
      const db = openRekordboxDb(libraries.rekordbox, { readonly: true, key: await rekordboxKey })
      if (!db) throw new Error(`rekordbox collection unreadable: ${libraries.rekordbox}`)
      try {
        if (findTrackByPath(db, path, options) !== null) return true
      } finally {
        db.close()
      }
    }
    if (libraries.engine) {
      engineRows ??= readEngineRows(libraries.engine)
      if ((await engineRows)(path, key).length > 0) return true
    }
    if (libraries.traktor) {
      nmlEntries ??= readFile(libraries.traktor, 'utf8').then(findEntries)
      const at = toNmlLocation(path)
      const same = (a: string, b: string) => a.normalize('NFC') === b.normalize('NFC')
      // An empty volume is the boot disk, which Traktor stores under its own name.
      if (
        (await nmlEntries).some(
          (e) =>
            same(e.dir, at.dir) &&
            same(e.file, at.file) &&
            (!at.volume || same(e.volume, at.volume)),
        )
      )
        return true
    }
    return false
  }
}

async function readEngineRows(libraryDir: string) {
  const SQL = await loadSqlJs()
  const db = new SQL.Database(await readFile(join(libraryDir, 'Database2', 'm.db')))
  try {
    const rows = (db.exec('SELECT path FROM Track')[0]?.values ?? []).map(([stored]) => ({
      path: String(stored),
    }))
    return engineRowFinder(libraryDir, rows)
  } finally {
    db.close()
  }
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
    const uuid = String(db.exec('SELECT uuid FROM Information')[0].values[0][0])
    const rows = (db.exec('SELECT id, path FROM Track')[0]?.values ?? []).map(([id, stored]) => ({
      id: Number(id),
      path: String(stored),
    }))
    const find = engineRowFinder(libraryDir, rows)
    return paths.map((path) => {
      const found = find(path, key)
      if (found.length !== 1) return null
      const lists = db.exec(
        'SELECT count(DISTINCT listId) FROM PlaylistEntity WHERE trackId = ? AND databaseUuid = ?',
        [found[0].id, uuid],
      )
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

export interface LibraryGenre {
  source: 'rekordbox' | 'traktor' | 'engine'
  value: string
}

// Read only, for the damage scan: the genre each library keeps for each file. A library that
// cannot be read, lacks the file or holds it twice is left out, as in libraryCopyInfo.
export async function libraryGenresOf(
  paths: string[],
  libraries: SyncedLibraries,
  options: PathMatchOptions = {},
): Promise<Record<string, LibraryGenre[]>> {
  const out: Record<string, LibraryGenre[]> = Object.fromEntries(paths.map((p) => [p, []]))
  const add = (source: LibraryGenre['source'], found: (string | null)[]) =>
    paths.forEach((p, i) => {
      if (found[i]) out[p].push({ source, value: found[i] })
    })
  if (libraries.rekordbox) {
    try {
      const db = openRekordboxDb(libraries.rekordbox, {
        readonly: true,
        key: await rekordboxRawKey(libraries.rekordbox),
      })
      if (db)
        try {
          const genre = db.prepare(
            'SELECT g.Name AS name FROM djmdContent c JOIN djmdGenre g ON g.ID = c.GenreID WHERE c.ID = ?',
          )
          add(
            'rekordbox',
            paths.map((p) => {
              const match = findTrackByPath(db, p, { ...options, quiet: true })
              if (match === null || isAmbiguous(match)) return null
              return (genre.get(match.id) as { name: string } | undefined)?.name ?? null
            }),
          )
        } finally {
          db.close()
        }
    } catch {}
  }
  if (libraries.engine) {
    try {
      const SQL = await loadSqlJs()
      const db = new SQL.Database(await readFile(join(libraries.engine, 'Database2', 'm.db')))
      try {
        const rows = (db.exec('SELECT id, path, genre FROM Track')[0]?.values ?? []).map(
          ([id, stored, genre]) => ({ id: Number(id), path: String(stored), genre }),
        )
        const find = engineRowFinder(libraries.engine, rows)
        add(
          'engine',
          paths.map((p) => {
            const found = find(p, pathKey(options))
            return found.length === 1 && found[0].genre ? String(found[0].genre) : null
          }),
        )
      } finally {
        db.close()
      }
    } catch {}
  }
  if (libraries.traktor) {
    try {
      const nml = await readFile(libraries.traktor, 'utf8')
      const entries = findEntries(nml)
      const same = (a: string, b: string) => a.normalize('NFC') === b.normalize('NFC')
      add(
        'traktor',
        paths.map((p) => {
          const at = toNmlLocation(p)
          const found = entries.filter(
            (e) =>
              same(e.dir, at.dir) &&
              same(e.file, at.file) &&
              (!at.volume || same(e.volume, at.volume)),
          )
          if (found.length !== 1) return null
          const info = nml.slice(found[0].start, found[0].end).match(/<INFO\b[^>]*>/)?.[0]
          return info ? attr(info, 'GENRE') || null : null
        }),
      )
    } catch {}
  }
  return out
}

// Read only: the id each library gives the file, for the cue editor to place a flow on the
// same track everywhere. A library that cannot be read, lacks the file or holds it twice is
// left out, since there is then no one track to write to.
export async function libraryTracksOf(
  path: string,
  libraries: SyncedLibraries,
  options: PathMatchOptions = {},
): Promise<LibraryTracks> {
  const out: LibraryTracks = {}
  if (libraries.rekordbox) {
    try {
      const db = openRekordboxDb(libraries.rekordbox, {
        readonly: true,
        key: await rekordboxRawKey(libraries.rekordbox),
      })
      if (db)
        try {
          const match = findTrackByPath(db, path, { ...options, quiet: true })
          if (match !== null && !isAmbiguous(match)) out.rekordbox = match.id
        } finally {
          db.close()
        }
    } catch {}
  }
  if (libraries.engine) {
    try {
      const SQL = await loadSqlJs()
      const db = new SQL.Database(await readFile(join(libraries.engine, 'Database2', 'm.db')))
      try {
        const rows = (db.exec('SELECT id, path FROM Track')[0]?.values ?? []).map(
          ([id, stored]) => ({ id: Number(id), path: String(stored) }),
        )
        const found = engineRowFinder(libraries.engine, rows)(path, pathKey(options))
        if (found.length === 1) out.engine = engineContentId(found[0].id)
      } finally {
        db.close()
      }
    } catch {}
  }
  if (libraries.traktor) {
    try {
      const entries = findEntries(await readFile(libraries.traktor, 'utf8'))
      const at = toNmlLocation(path)
      const same = (a: string, b: string) => a.normalize('NFC') === b.normalize('NFC')
      const found = entries.filter(
        (e) =>
          same(e.dir, at.dir) && same(e.file, at.file) && (!at.volume || same(e.volume, at.volume)),
      )
      if (found.length === 1)
        out.traktor = traktorContentId(`${found[0].volume}${found[0].dir}${found[0].file}`)
    } catch {}
  }
  return out
}
