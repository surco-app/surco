import { readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative, resolve } from 'node:path'
import log from 'electron-log/main'
import type { Database } from 'sql.js'
import { loadSqlJs } from './engine'
import { assertEngineClosed, withEngineDatabase } from './engineLibrary'
import { backupOf } from './libraryBackups'
import { type PathMatchOptions, pathKey } from './libraryPathKey'
import { writeBackup } from './rekordboxSessionBackup'
import { renameWithRetry } from './renameRetry'

// Moves an existing Engine DJ library row onto the file a conversion just produced, so the
// track keeps its id and therefore its playlists, cues, loops and beatgrid. The Engine
// twin of rekordboxLibrary.ts's repointTracks: only the row's file columns change, the
// library is backed up first, a running Engine refuses the write, two rows for one file
// refuse rather than guess, and the swap is write-then-rename.
//
// Best-effort: the conversion has already succeeded on disk by the time this runs, so
// nothing here throws to its caller. Every failure path returns a reason instead.

// The same fixed backup name engineLibrary.ts writes before its own changes.

export type EngineRepointResult =
  | { written: true; id: string }
  | { written: false; reason: 'no-match' | 'output-missing' | 'unreadable' | 'occupied' }
  | { written: false; reason: 'engine-running' | 'backup-failed' | 'write-failed' }
  | { written: false; reason: 'ambiguous'; ids: string[] }

export interface EngineRepoint extends PathMatchOptions {
  // The file the library points at now, and the one it should point at instead.
  from: string
  to: string
}

export interface EngineRepointOptions {
  // Takes the run's single pre-run copy, before the first write. A failure here refuses
  // the write like any other missing backup.
  sessionBackup?: (dbPath: string) => Promise<void>
}

// Engine stores each path relative to the library folder, forward-slashed. Matching
// compares the absolute, resolved form; NFC first, because APFS treats NFC and NFD names as
// one file while a byte compare would not.
export function absolute(libraryDir: string, stored: string): string {
  return resolve(libraryDir, stored).normalize('NFC')
}

// The rows whose stored path resolves to a file. Resolving pays an lstat per path
// component, on a NAS hundreds of ms per hundred rows, and the library holds every track
// the DJ owns. The links a library is reached through are folders, so a file keeps its
// name through them: only rows of the same name, compared case-insensitively as pathKey
// does, are resolved at all, the narrowing rekordbox's candidateRows makes by FileNameL.
export function engineRowFinder<T extends { path: string }>(
  libraryDir: string,
  rows: T[],
): (file: string, key: (path: string) => string) => T[] {
  const byName = new Map<string, { row: T; at: string }[]>()
  for (const row of rows) {
    const at = absolute(libraryDir, row.path)
    const name = basename(at).toLowerCase()
    const same = byName.get(name)
    if (same) same.push({ row, at })
    else byName.set(name, [{ row, at }])
  }
  return (file, key) => {
    const nfc = file.normalize('NFC')
    const target = key(nfc)
    return (byName.get(basename(nfc).toLowerCase()) ?? [])
      .filter((c) => key(c.at) === target)
      .map((c) => c.row)
  }
}

function relativeTo(libraryDir: string, file: string): string {
  return relative(libraryDir, file).split('\\').join('/')
}

export function repointEngineTracks(
  libraryDir: string,
  repoints: EngineRepoint[],
  options: EngineRepointOptions = {},
): Promise<EngineRepointResult[]> {
  return withEngineDatabase(join(libraryDir, 'Database2', 'm.db'), () =>
    writeEngineRepoints(libraryDir, repoints, options),
  )
}

export async function writeEngineRepoints(
  libraryDir: string,
  repoints: EngineRepoint[],
  options: EngineRepointOptions = {},
): Promise<EngineRepointResult[]> {
  const dbPath = join(libraryDir, 'Database2', 'm.db')
  const results: (EngineRepointResult | null)[] = repoints.map(() => null)

  const sizes = await Promise.all(
    repoints.map(async (r) => {
      try {
        return (await stat(r.to)).size
      } catch {
        return null
      }
    }),
  )
  sizes.forEach((size, i) => {
    if (size === null) results[i] = { written: false, reason: 'output-missing' }
  })

  const fill = (result: EngineRepointResult) => results.map((r) => r ?? result)
  if (results.every((r) => r !== null)) return results as EngineRepointResult[]

  try {
    await assertEngineClosed(dbPath)
  } catch {
    return fill({ written: false, reason: 'engine-running' })
  }

  let db: Database
  try {
    const SQL = await loadSqlJs()
    db = new SQL.Database(await readFile(dbPath))
    db.exec('SELECT id FROM Track LIMIT 1')
  } catch (e) {
    log.warn(`Engine DJ repoint: cannot read ${dbPath}: ${(e as Error).message}`)
    return fill({ written: false, reason: 'unreadable' })
  }

  try {
    const stored = (db.exec('SELECT id, path FROM Track ORDER BY id')[0]?.values ?? []).map(
      ([id, path]) => ({
        id: String(id),
        path: String(path),
      }),
    )
    const find = engineRowFinder(libraryDir, stored)
    const updates: { id: string; to: string; size: number }[] = []
    for (const [i, repoint] of repoints.entries()) {
      if (results[i]) continue
      const key = pathKey(repoint)
      const matches = find(repoint.from, key)
      if (matches.length === 0) {
        results[i] = { written: false, reason: 'no-match' }
        continue
      }
      if (matches.length > 1) {
        results[i] = { written: false, reason: 'ambiguous', ids: matches.map((m) => m.id) }
        continue
      }
      if (find(repoint.to, key).some((row) => row.id !== matches[0].id)) {
        results[i] = { written: false, reason: 'occupied' }
        continue
      }
      updates.push({ id: matches[0].id, to: repoint.to, size: sizes[i] as number })
      results[i] = { written: true, id: matches[0].id }
    }
    if (updates.length === 0) return results as EngineRepointResult[]

    try {
      await options.sessionBackup?.(dbPath)
      await writeBackup(dbPath, backupOf(dbPath, 'backup'))
    } catch (e) {
      log.warn(`Engine DJ repoint: backup failed: ${(e as Error).message}`)
      return results.map((r) =>
        r?.written ? { written: false, reason: 'backup-failed' } : r,
      ) as EngineRepointResult[]
    }

    for (const u of updates) {
      // Only the file columns. The bitrate is cleared rather than kept, as Surco's own
      // inserts leave it: the old file's value would describe the new one wrongly, and
      // Engine fills it in when it next analyzes the track.
      db.run(
        'UPDATE Track SET path = ?, filename = ?, fileType = ?, fileBytes = ?, bitrate = NULL WHERE id = ?',
        [
          relativeTo(libraryDir, u.to),
          basename(u.to),
          extname(u.to).slice(1).toLowerCase(),
          u.size,
          Number(u.id),
        ],
      )
    }

    // Engine launched while the rows were being read would have loaded the old library and
    // write it back over this one on quit, so the check repeats right before the swap.
    try {
      await assertEngineClosed(dbPath)
    } catch {
      return results.map((r) =>
        r?.written ? { written: false, reason: 'engine-running' } : r,
      ) as EngineRepointResult[]
    }
    const tmp = `${dbPath}.surco-tmp`
    try {
      await writeFile(tmp, db.export())
      await renameWithRetry(tmp, dbPath)
    } catch (e) {
      log.warn(`Engine DJ repoint: write failed: ${(e as Error).message}`)
      await unlink(tmp).catch(() => {})
      return results.map((r) =>
        r?.written ? { written: false, reason: 'write-failed' } : r,
      ) as EngineRepointResult[]
    }
    return results as EngineRepointResult[]
  } finally {
    db.close()
  }
}
