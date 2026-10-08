import { copyFile, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import log from 'electron-log/main'
import type { Database } from 'sql.js'
import type { DuplicatePair } from '../shared/types'
import { loadSqlJs } from './engine'
import { assertEngineClosed } from './engineLibrary'
import { absolute, repointEngineTracks } from './engineRepoint'
import { type PathMatchOptions, pathKey } from './libraryPathKey'
import type { DuplicateReplaceResult } from './rekordboxDuplicates'
import { renameWithRetry } from './renameRetry'

// The Engine DJ side of removing a duplicate copy, with engineTags.ts's lifecycle: Engine
// closed, a backup first, write-then-rename. With only the removed copy in the library its
// row is repointed (engineRepoint.ts). With both, the removed copy's playlist entries move
// to the kept track. Its Track row stays: Engine's other databases (history, sync) can name
// a track id, and nothing here can show that deleting it leaves them valid. The file then
// stays on disk too, since the library still uses it.

const BACKUP_SUFFIX = '.surco-backup'

export interface EngineDuplicateOptions extends PathMatchOptions {
  sessionBackup?: (dbPath: string) => Promise<void>
}

// A list holds a track once (C_NAME_UNIQUE_FOR_LIST), so where the kept copy is already
// there the entity goes and its neighbour inherits its link, as Engine's own delete
// trigger does.
function replace(db: Database, uuid: string, fromId: number, toId: number): void {
  const entities = (
    db.exec(
      'SELECT id, listId, nextEntityId FROM PlaylistEntity WHERE trackId = ? AND databaseUuid = ?',
      [fromId, uuid],
    )[0]?.values ?? []
  ).map(([id, listId, next]) => ({ id: Number(id), listId: Number(listId), next: Number(next) }))
  for (const e of entities) {
    const holding = db.exec(
      'SELECT 1 FROM PlaylistEntity WHERE listId = ? AND trackId = ? AND databaseUuid = ?',
      [e.listId, toId, uuid],
    )
    if (holding.length === 0) {
      db.run('UPDATE PlaylistEntity SET trackId = ? WHERE id = ?', [toId, e.id])
      continue
    }
    db.run('UPDATE PlaylistEntity SET nextEntityId = ? WHERE nextEntityId = ? AND listId = ?', [
      e.next,
      e.id,
      e.listId,
    ])
    db.run('DELETE FROM PlaylistEntity WHERE id = ?', [e.id])
  }
}

export async function replaceEngineDuplicates(
  libraryDir: string,
  pairs: DuplicatePair[],
  options: EngineDuplicateOptions = {},
): Promise<DuplicateReplaceResult[]> {
  const dbPath = join(libraryDir, 'Database2', 'm.db')
  const results: (DuplicateReplaceResult | null)[] = pairs.map(() => null)
  const settle = (fallback: DuplicateReplaceResult) => results.map((r) => r ?? fallback)

  try {
    await assertEngineClosed(dbPath)
  } catch {
    return settle({ written: false, reason: 'engine-running' })
  }

  let db: Database
  let uuid: string
  try {
    const SQL = await loadSqlJs()
    db = new SQL.Database(await readFile(dbPath))
    db.exec('SELECT id FROM Track LIMIT 1')
    uuid = String(db.exec('SELECT uuid FROM Information')[0].values[0][0])
  } catch (e) {
    log.warn(`Engine DJ duplicates: cannot read ${dbPath}: ${(e as Error).message}`)
    return settle({ written: false, reason: 'unreadable' })
  }

  const repoints: number[] = []
  try {
    const stored = (db.exec('SELECT id, path FROM Track ORDER BY id')[0]?.values ?? []).map(
      ([id, path]) => ({ id: Number(id), path: String(path) }),
    )
    const key = pathKey(options)
    const find = (path: string) => {
      const target = key(path.normalize('NFC'))
      return stored.filter((row) => key(absolute(libraryDir, row.path)) === target)
    }
    const replaces: { index: number; fromId: number; toId: number }[] = []
    for (const [index, { from, to }] of pairs.entries()) {
      const source = find(from)
      const kept = find(to)
      if (source.length > 1 || kept.length > 1)
        results[index] = { written: false, reason: 'ambiguous' }
      else if (source.length === 0 || source[0].id === kept[0]?.id)
        results[index] = { written: false, reason: 'no-match' }
      else if (kept.length === 0) {
        // Engine holds one row per path, so only the first removed copy can move onto it.
        if (repoints.some((i) => pairs[i].to === to))
          results[index] = { written: false, reason: 'kept-taken' }
        else repoints.push(index)
      } else replaces.push({ index, fromId: source[0].id, toId: kept[0].id })
    }

    if (replaces.length > 0) {
      const reason = await writeReplaces(db, dbPath, uuid, replaces, options)
      for (const r of replaces)
        results[r.index] = reason
          ? { written: false, reason }
          : { written: true, outcome: 'replaced' }
    }
  } finally {
    db.close()
  }

  if (repoints.length > 0) {
    const repointed = await repointEngineTracks(
      libraryDir,
      repoints.map((i) => ({ ...pairs[i], ...options })),
      { sessionBackup: options.sessionBackup },
    )
    repointed.forEach((r, k) => {
      results[repoints[k]] = r.written
        ? { written: true, outcome: 'repointed' }
        : { written: false, reason: r.reason }
    })
  }
  return settle({ written: false, reason: 'no-match' })
}

async function writeReplaces(
  db: Database,
  dbPath: string,
  uuid: string,
  replaces: { fromId: number; toId: number }[],
  options: EngineDuplicateOptions,
): Promise<string | null> {
  try {
    await options.sessionBackup?.(dbPath)
    await copyFile(dbPath, `${dbPath}${BACKUP_SUFFIX}`)
  } catch (e) {
    log.warn(`Engine DJ duplicates: backup failed: ${(e as Error).message}`)
    return 'backup-failed'
  }
  try {
    for (const r of replaces) replace(db, uuid, r.fromId, r.toId)
  } catch (e) {
    log.warn(`Engine DJ duplicates: cannot move the entries: ${(e as Error).message}`)
    return 'write-failed'
  }
  // Engine launched while the rows were being read would write its old copy back over
  // this one on quit, so the check repeats right before the swap.
  try {
    await assertEngineClosed(dbPath)
  } catch {
    return 'engine-running'
  }
  const tmp = `${dbPath}.surco-tmp`
  try {
    await writeFile(tmp, db.export())
    await renameWithRetry(tmp, dbPath)
  } catch (e) {
    log.warn(`Engine DJ duplicates: write failed: ${(e as Error).message}`)
    await unlink(tmp).catch(() => {})
    return 'write-failed'
  }
  return null
}
