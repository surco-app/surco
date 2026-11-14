import { randomUUID } from 'node:crypto'
import type { openRekordboxDb } from './rekordboxDb'
import { rekordboxStamp, takeLocalUsn, unusedRowId } from './rekordboxRows'

type RekordboxDb = NonNullable<ReturnType<typeof openRekordboxDb>>

const EITHER_ORDER = `(ContentID1 = ? AND ContentID2 = ?) OR (ContentID1 = ? AND ContentID2 = ?)`

export function addMatching(db: RekordboxDb, a: string, b: string, ctx: { now: Date }): boolean {
  const found = db
    .prepare(
      `SELECT 1 FROM djmdRecommendLike WHERE coalesce(rb_local_deleted, 0) = 0 AND (${EITHER_ORDER})`,
    )
    .get(a, b, b, a)
  if (found) return false
  const stamp = rekordboxStamp(ctx.now)
  const usn = takeLocalUsn(db, stamp)
  const ms = ctx.now.getTime()
  db.prepare(
    `INSERT INTO djmdRecommendLike (ID, ContentID1, ContentID2, LikeRate, DataCreatedH,
       DataCreatedL, UUID, rb_data_status, rb_local_data_status, rb_local_deleted,
       rb_local_synced, usn, rb_local_usn, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, 0, 0, 0, 0, NULL, ?, ?, ?)`,
  ).run(
    unusedRowId(db, 'djmdRecommendLike', randomUUID),
    a,
    b,
    Math.floor(ms / 2 ** 32),
    ms % 2 ** 32,
    randomUUID(),
    usn,
    stamp,
    stamp,
  )
  return true
}

export function removeMatching(db: RekordboxDb, a: string, b: string): boolean {
  return (
    db.prepare(`DELETE FROM djmdRecommendLike WHERE ${EITHER_ORDER}`).run(a, b, b, a).changes > 0
  )
}
