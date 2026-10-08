import { copyFile } from 'node:fs/promises'
import log from 'electron-log/main'
import type { DuplicatePair } from '../shared/types'
import { type FindOptions, findTrackByPath, isAmbiguous, openRekordboxDb } from './rekordboxDb'
import { repointTracks } from './rekordboxLibrary'
import { isRekordboxRunning } from './rekordboxProcess'
import { nextUsn, stamp } from './rekordboxTags'

// When the user removes a duplicate copy from Music, rekordbox moves to the copy they kept.
// With only the removed copy in the collection its row is repointed (rekordboxLibrary.ts),
// so cues and playlists follow. With both, the removed copy's playlist entries move to the
// kept row; an entry whose playlist already holds the kept copy is deleted, as rekordbox
// deletes playlist entries itself. The removed copy's own row stays, with its cues: nothing
// shows that rekordbox hides a row marked rb_local_deleted, so it is left out of every
// playlist instead, and its file stays on disk.

type Db = NonNullable<ReturnType<typeof openRekordboxDb>>

const BACKUP_SUFFIX = '.surco-backup'
const LIVE = '(rb_local_deleted IS NULL OR rb_local_deleted = 0)'

export type DuplicateReplaceResult =
  | { written: true; outcome: 'repointed' | 'replaced' }
  | { written: false; reason: string }

export interface ReplaceOptions extends FindOptions {
  sessionBackup?: (path: string) => Promise<void>
}

// One run is one operation for rekordbox: every row it touches carries the same usn.
function touch(db: Db, usn: number, id: string, set: Record<string, unknown>): void {
  const columns = { ...set, rb_local_usn: usn, updated_at: stamp() }
  const names = Object.keys(columns)
  db.prepare(
    `UPDATE djmdSongPlaylist SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE ID = ?`,
  ).run(...Object.values(columns), id)
}

interface Entry {
  ID: string
  PlaylistID: string
  TrackNo: number | null
}

// Whether a playlist already holds the kept copy is read before anything moves, so a song
// the DJ put in a playlist twice keeps both places.
function replace(db: Db, usn: number, fromId: string, toId: string): void {
  const entries = db
    .prepare(
      `SELECT ID, PlaylistID, TrackNo FROM djmdSongPlaylist WHERE ContentID = ? AND ${LIVE} ORDER BY PlaylistID, TrackNo`,
    )
    .all(fromId) as Entry[]
  const holding = new Set(
    (
      db
        .prepare(`SELECT DISTINCT PlaylistID FROM djmdSongPlaylist WHERE ContentID = ? AND ${LIVE}`)
        .all(toId) as { PlaylistID: string }[]
    ).map((r) => r.PlaylistID),
  )
  for (const entry of entries) {
    if (!holding.has(entry.PlaylistID)) {
      touch(db, usn, entry.ID, { ContentID: toId })
      continue
    }
    const at = db.prepare(`SELECT TrackNo FROM djmdSongPlaylist WHERE ID = ?`).get(entry.ID) as {
      TrackNo: number | null
    }
    db.prepare(`DELETE FROM djmdSongPlaylist WHERE ID = ?`).run(entry.ID)
    if (at.TrackNo === null) continue
    // rekordbox numbers each playlist 1..n with no gaps; the real collection has none.
    const after = db
      .prepare(
        `SELECT ID, TrackNo FROM djmdSongPlaylist WHERE PlaylistID = ? AND TrackNo > ? AND ${LIVE}`,
      )
      .all(entry.PlaylistID, at.TrackNo) as { ID: string; TrackNo: number }[]
    for (const row of after) touch(db, usn, row.ID, { TrackNo: row.TrackNo - 1 })
  }
}

export async function replaceRekordboxDuplicates(
  collectionPath: string,
  pairs: DuplicatePair[],
  options: ReplaceOptions = {},
): Promise<DuplicateReplaceResult[]> {
  const results: (DuplicateReplaceResult | undefined)[] = pairs.map(() => undefined)
  const settle = (r: DuplicateReplaceResult) => results.map((x) => x ?? r)
  if (await isRekordboxRunning()) return settle({ written: false, reason: 'rekordbox-running' })
  const db = openRekordboxDb(collectionPath, { readonly: true })
  if (!db) return settle({ written: false, reason: 'unreadable' })
  const repoints: number[] = []
  const replaces: { index: number; fromId: string; toId: string }[] = []
  try {
    for (const [index, { from, to }] of pairs.entries()) {
      const source = findTrackByPath(db, from, options)
      const kept = findTrackByPath(db, to, options)
      if (isAmbiguous(source) || isAmbiguous(kept))
        results[index] = { written: false, reason: 'ambiguous' }
      else if (source === null || source.id === kept?.id)
        results[index] = { written: false, reason: 'no-match' }
      else if (kept === null) {
        // A second removed copy onto the same kept file would leave two rows on one file.
        if (repoints.some((i) => pairs[i].to === to))
          results[index] = { written: false, reason: 'kept-taken' }
        else repoints.push(index)
      } else replaces.push({ index, fromId: source.id, toId: kept.id })
    }
  } finally {
    db.close()
  }

  if (replaces.length > 0) {
    const reason = await writeReplaces(collectionPath, replaces, options)
    for (const r of replaces)
      results[r.index] = reason
        ? { written: false, reason }
        : { written: true, outcome: 'replaced' }
  }
  if (repoints.length > 0) {
    const repointed = await repointTracks(
      collectionPath,
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
  collectionPath: string,
  replaces: { fromId: string; toId: string }[],
  options: ReplaceOptions,
): Promise<string | null> {
  try {
    await options.sessionBackup?.(collectionPath)
    await copyFile(collectionPath, `${collectionPath}${BACKUP_SUFFIX}`)
  } catch {
    return 'backup-failed'
  }
  if (await isRekordboxRunning()) return 'rekordbox-running'
  const write = openRekordboxDb(collectionPath)
  if (!write) return 'unreadable'
  try {
    write.transaction(() => {
      const usn = nextUsn(write)
      for (const r of replaces) replace(write, usn, r.fromId, r.toId)
    })()
    return null
  } catch (e) {
    if (String((e as { code?: unknown })?.code).startsWith('SQLITE_READONLY')) return 'read-only'
    log.warn(`rekordbox duplicates: write failed: ${(e as Error).message}`)
    return 'write-failed'
  } finally {
    write.close()
  }
}
