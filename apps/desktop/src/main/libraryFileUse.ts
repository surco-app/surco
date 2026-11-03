import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { WritableProgram } from '../shared/djProgram'
import { writableInOrder } from '../shared/djProgram'
import { engineContentId } from '../shared/engineContent'
import { traktorContentId } from '../shared/traktorContent'
import type { LibraryCopyInfo, LibraryCopyPresence, LibraryTracks } from '../shared/types'
import { loadSqlJs } from './engine'
import { engineRowFinder } from './engineRepoint'
import { toNmlLocation } from './ffmpeg'
import { type PathMatchOptions, pathKey } from './libraryPathKey'
import { findTrackByPath, isAmbiguous, openRekordboxDb, rekordboxRawKey } from './rekordboxDb'
import { attr, findEntries, nmlCopyInfo } from './traktorNml'
import { traktorFileOf } from './traktorPlaylists'

// Each library's location, or '' when its sync is off.
export type SyncedLibraries = Record<WritableProgram, string>

const LIBRARY_ORDER = writableInOrder(['rekordbox', 'engine', 'traktor'])

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
  let nmlFiles: Promise<Map<string, string[]>> | undefined
  const holds: Record<WritableProgram, (location: string, path: string) => Promise<boolean>> = {
    rekordbox: async (collection, path) => {
      rekordboxKey ??= rekordboxRawKey(collection)
      const db = openRekordboxDb(collection, { readonly: true, key: await rekordboxKey })
      if (!db) throw new Error(`rekordbox collection unreadable: ${collection}`)
      try {
        return findTrackByPath(db, path, options) !== null
      } finally {
        db.close()
      }
    },
    engine: async (libraryDir, path) => {
      engineRows ??= readEngineRows(libraryDir)
      return (await engineRows)(path, key).length > 0
    },
    traktor: async (nmlPath, path) => {
      nmlFiles ??= readFile(nmlPath, 'utf8').then(traktorFiles)
      const nfc = path.normalize('NFC')
      const target = key(nfc)
      const sameName = (await nmlFiles).get(basename(nfc).toLowerCase()) ?? []
      return sameName.some((file) => key(file) === target)
    },
  }
  return async (path) => {
    for (const library of LIBRARY_ORDER)
      if (libraries[library] && (await holds[library](libraries[library], path))) return true
    return false
  }
}

// Every file the collection holds, by lowercased composed name, so only the entries that
// share the name pay a resolve. An entry on a named volume may be the boot disk under its
// own name or a mounted one, and the boot disk's name is not asked: both spellings are kept.
function traktorFiles(nml: string): Map<string, string[]> {
  const byName = new Map<string, string[]>()
  for (const entry of findEntries(nml)) {
    if (!entry.file) continue
    const block = nml.slice(entry.start, entry.end)
    const name = entry.file.normalize('NFC').toLowerCase()
    const spellings = [traktorFileOf(block, entry.volume), traktorFileOf(block, '')]
    byName.set(name, [...(byName.get(name) ?? []), ...new Set(spellings)])
  }
  return byName
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

const COPY_INFO: Record<
  WritableProgram,
  (
    location: string,
    paths: string[],
    options: PathMatchOptions,
  ) => LibraryCopyPresence[] | Promise<LibraryCopyPresence[]>
> = {
  rekordbox: rekordboxInfo,
  engine: engineInfo,
  traktor: async (nmlPath, paths) => {
    const nml = await readFile(nmlPath, 'utf8')
    return paths.map((p) => nmlCopyInfo(nml, toNmlLocation(p)))
  },
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
  for (const library of LIBRARY_ORDER) {
    if (!libraries[library]) continue
    try {
      fill(library, await COPY_INFO[library](libraries[library], paths, options))
    } catch {}
  }
  return info
}

export interface LibraryGenre {
  source: WritableProgram
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

const TRACK_OF: Record<
  WritableProgram,
  (location: string, path: string, options: PathMatchOptions) => Promise<string | undefined>
> = {
  rekordbox: async (collection, path, options) => {
    const db = openRekordboxDb(collection, {
      readonly: true,
      key: await rekordboxRawKey(collection),
    })
    if (db)
      try {
        const match = findTrackByPath(db, path, { ...options, quiet: true })
        if (match !== null && !isAmbiguous(match)) return match.id
      } finally {
        db.close()
      }
    return undefined
  },
  engine: async (libraryDir, path, options) => {
    const SQL = await loadSqlJs()
    const db = new SQL.Database(await readFile(join(libraryDir, 'Database2', 'm.db')))
    try {
      const rows = (db.exec('SELECT id, path FROM Track')[0]?.values ?? []).map(([id, stored]) => ({
        id: Number(id),
        path: String(stored),
      }))
      const found = engineRowFinder(libraryDir, rows)(path, pathKey(options))
      return found.length === 1 ? engineContentId(found[0].id) : undefined
    } finally {
      db.close()
    }
  },
  traktor: async (nmlPath, path) => {
    const entries = findEntries(await readFile(nmlPath, 'utf8'))
    const at = toNmlLocation(path)
    const same = (a: string, b: string) => a.normalize('NFC') === b.normalize('NFC')
    const found = entries.filter(
      (e) =>
        same(e.dir, at.dir) && same(e.file, at.file) && (!at.volume || same(e.volume, at.volume)),
    )
    return found.length === 1
      ? traktorContentId(`${found[0].volume}${found[0].dir}${found[0].file}`)
      : undefined
  },
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
  for (const library of LIBRARY_ORDER) {
    if (!libraries[library]) continue
    try {
      const track = await TRACK_OF[library](libraries[library], path, options)
      if (track !== undefined) out[library] = track
    } catch {}
  }
  return out
}
