import { matchingChains } from '../shared/matchingChains'
import type { openRekordboxDb } from './rekordboxDb'

type RekordboxDb = NonNullable<ReturnType<typeof openRekordboxDb>>

const LIVE = `coalesce(m.rb_local_deleted, 0) = 0
  AND EXISTS (SELECT 1 FROM djmdContent c WHERE c.ID = m.ContentID1 AND coalesce(c.rb_local_deleted, 0) = 0)
  AND EXISTS (SELECT 1 FROM djmdContent c WHERE c.ID = m.ContentID2 AND coalesce(c.rb_local_deleted, 0) = 0)`

function hasMatchingTable(db: RekordboxDb): boolean {
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
