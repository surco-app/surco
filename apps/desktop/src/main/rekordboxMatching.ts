import { matchingChains } from '../shared/matchingChains'
import type { openRekordboxDb } from './rekordboxDb'
import { IS_SEPARATOR } from './rekordboxPlaylists'

type RekordboxDb = NonNullable<ReturnType<typeof openRekordboxDb>>

const LIVE = `coalesce(m.rb_local_deleted, 0) = 0
  AND EXISTS (SELECT 1 FROM djmdContent c WHERE c.ID = m.ContentID1 AND coalesce(c.rb_local_deleted, 0) = 0)
  AND EXISTS (SELECT 1 FROM djmdContent c WHERE c.ID = m.ContentID2 AND coalesce(c.rb_local_deleted, 0) = 0)`

export function hasMatchingTable(db: RekordboxDb): boolean {
  return (
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'djmdRecommendLike'`)
      .get() !== undefined
  )
}

export function readMatchingPairs(db: RekordboxDb): [string, string][] {
  if (!hasMatchingTable(db)) return []
  const rows = db
    .prepare(
      `SELECT m.ContentID1 AS a, m.ContentID2 AS b FROM djmdRecommendLike m WHERE ${LIVE}
        ORDER BY m.created_at, m.ID`,
    )
    .all() as { a: string | number; b: string | number }[]
  return rows.map((r) => [String(r.a), String(r.b)])
}

export function readMatchingCount(db: RekordboxDb): number {
  return new Set(readMatchingPairs(db).flat()).size
}

export function readMatchingChains(db: RekordboxDb): string[][] {
  const pairs = readMatchingPairs(db)
  if (pairs.length === 0) return []
  const ids = [...new Set(pairs.flat())]
  const rows = db
    .prepare(`SELECT ID, Title FROM djmdContent WHERE ID IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as { ID: string | number; Title: string | null }[]
  const titles = new Map(rows.map((r) => [String(r.ID), r.Title?.trim() ?? '']))
  return matchingChains(pairs, (id) => titles.get(id) ?? '')
}

interface PlayedRow {
  run: string | number
  contentId: string | number
  live: number
}

function cutAtGaps(rows: readonly PlayedRow[]): string[][] {
  const sequences: string[][] = []
  let current: string[] = []
  let run: string | number | null = null
  const close = (): void => {
    if (current.length > 0) sequences.push(current)
    current = []
  }
  for (const row of rows) {
    if (row.run !== run) {
      close()
      run = row.run
    }
    if (row.live) current.push(String(row.contentId))
    else close()
  }
  close()
  return sequences
}

export function readPlayedSequences(db: RekordboxDb, playlistIds: readonly string[]): string[][] {
  const live = `CASE WHEN c.ID IS NULL OR coalesce(c.rb_local_deleted, 0) = 1 OR ${IS_SEPARATOR} THEN 0 ELSE 1 END`
  const history = db
    .prepare(
      `SELECT h.HistoryID AS run, h.ContentID AS contentId, ${live} AS live
         FROM djmdSongHistory h LEFT JOIN djmdContent c ON c.ID = h.ContentID
        WHERE coalesce(h.rb_local_deleted, 0) = 0
        ORDER BY h.HistoryID, h.TrackNo`,
    )
    .all() as PlayedRow[]
  const playlists =
    playlistIds.length === 0
      ? []
      : (db
          .prepare(
            `SELECT s.PlaylistID AS run, s.ContentID AS contentId, ${live} AS live
               FROM djmdSongPlaylist s LEFT JOIN djmdContent c ON c.ID = s.ContentID
              WHERE coalesce(s.rb_local_deleted, 0) = 0
                AND s.PlaylistID IN (${playlistIds.map(() => '?').join(',')})
              ORDER BY s.PlaylistID, s.TrackNo`,
          )
          .all(...playlistIds) as PlayedRow[])
  return [...cutAtGaps(history), ...cutAtGaps(playlists)]
}
