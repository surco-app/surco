import { copyFile, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import log from 'electron-log/main'
import type { Database } from 'sql.js'
import type { LibraryTagUpdate, TagChange } from '../shared/types'
import { loadSqlJs } from './engine'
import { assertEngineClosed } from './engineLibrary'
import { absolute } from './engineRepoint'
import { type PathMatchOptions, pathKey } from './libraryPathKey'
import type { LibraryRepointResult } from './libraryRepointFlush'
import { renameWithRetry } from './renameRetry'

// Rewrites the text names Engine DJ keeps on a Track row when a review fixed the file.
// The twin of engineRepoint.ts: Engine closed, a backup first, write-then-rename, and a
// row Engine already spells otherwise is left alone rather than overwritten.

const BACKUP_SUFFIX = '.surco-backup'
const FIELDS = ['title', 'artist', 'album', 'genre'] as const
type EngineField = (typeof FIELDS)[number]

// Engine stores no album artist, so that field never reaches this library.
const isEngineField = (field: string): field is EngineField =>
  (FIELDS as readonly string[]).includes(field)

const sameText = (stored: unknown, expected: string) =>
  String(stored ?? '').normalize('NFC') === expected.normalize('NFC')

export interface EngineTagsOptions {
  sessionBackup?: (dbPath: string) => Promise<void>
}

export async function updateEngineTags(
  libraryDir: string,
  updates: (LibraryTagUpdate & PathMatchOptions)[],
  options: EngineTagsOptions = {},
): Promise<LibraryRepointResult[]> {
  const dbPath = join(libraryDir, 'Database2', 'm.db')
  const results: (LibraryRepointResult | null)[] = updates.map(() => null)
  const settle = (fallback: LibraryRepointResult) => results.map((r) => r ?? fallback)

  try {
    await assertEngineClosed(dbPath)
  } catch {
    return settle({ written: false, reason: 'engine-running' })
  }

  let db: Database
  try {
    const SQL = await loadSqlJs()
    db = new SQL.Database(await readFile(dbPath))
    db.exec('SELECT id FROM Track LIMIT 1')
  } catch (e) {
    log.warn(`Engine DJ tags: cannot read ${dbPath}: ${(e as Error).message}`)
    return settle({ written: false, reason: 'unreadable' })
  }

  try {
    const rows = (
      db.exec('SELECT id, path, title, artist, album, genre FROM Track ORDER BY id')[0]?.values ??
      []
    ).map(([id, path, title, artist, album, genre]) => ({
      id: Number(id),
      path: String(path),
      title,
      artist,
      album,
      genre,
    }))
    const writes: { index: number; id: number; set: [EngineField, TagChange][] }[] = []
    for (const [index, update] of updates.entries()) {
      const set = Object.entries(update.fields).filter(
        (entry): entry is [EngineField, TagChange] => isEngineField(entry[0]) && !!entry[1],
      )
      if (set.length === 0) {
        results[index] = { written: false, reason: 'no-match' }
        continue
      }
      const key = pathKey(update)
      const target = key(update.path.normalize('NFC'))
      const matches = rows.filter((row) => key(absolute(libraryDir, row.path)) === target)
      if (matches.length === 0) results[index] = { written: false, reason: 'no-match' }
      else if (matches.length > 1) results[index] = { written: false, reason: 'ambiguous' }
      else if (!set.every(([field, change]) => sameText(matches[0][field], change.from)))
        results[index] = { written: false, reason: 'changed' }
      else writes.push({ index, id: matches[0].id, set })
    }
    if (writes.length === 0) return settle({ written: false, reason: 'no-match' })

    try {
      await options.sessionBackup?.(dbPath)
      await copyFile(dbPath, `${dbPath}${BACKUP_SUFFIX}`)
    } catch (e) {
      log.warn(`Engine DJ tags: backup failed: ${(e as Error).message}`)
      return settle({ written: false, reason: 'backup-failed' })
    }

    for (const w of writes) {
      db.run(`UPDATE Track SET ${w.set.map(([field]) => `${field} = ?`).join(', ')} WHERE id = ?`, [
        ...w.set.map(([, change]) => change.to),
        w.id,
      ])
    }

    // Engine launched while the rows were being read would write its old copy back over
    // this one on quit, so the check repeats right before the swap.
    try {
      await assertEngineClosed(dbPath)
    } catch {
      return settle({ written: false, reason: 'engine-running' })
    }
    const tmp = `${dbPath}.surco-tmp`
    try {
      await writeFile(tmp, db.export())
      await renameWithRetry(tmp, dbPath)
    } catch (e) {
      log.warn(`Engine DJ tags: write failed: ${(e as Error).message}`)
      await unlink(tmp).catch(() => {})
      return settle({ written: false, reason: 'write-failed' })
    }
    for (const w of writes) results[w.index] = { written: true }
    return settle({ written: false, reason: 'no-match' })
  } finally {
    db.close()
  }
}
