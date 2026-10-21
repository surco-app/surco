import type Database from 'better-sqlite3-multiple-ciphers'

type Db = InstanceType<typeof Database>

// What every row Surco writes into a rekordbox collection shares with the rows rekordbox
// writes itself. Kept in one place because each writer (the metadata sync, the playlist
// edits) must make rows rekordbox cannot tell from its own.

// UTC with milliseconds and an explicit offset, the format of every created_at and
// updated_at in a rekordbox 7 collection.
export function rekordboxStamp(now: Date): string {
  return `${now.toISOString().replace('T', ' ').replace('Z', '')} +00:00`
}

export function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// rekordbox numbers every local change from one counter (agentRegistry localUpdateCount)
// and stamps the row with it (rb_local_usn). Taking the next number and moving the counter
// on keeps a row Surco writes ordered after every change rekordbox already made.
export function takeLocalUsn(db: Db, stamp: string): number {
  const { int_1 } = db
    .prepare(`SELECT int_1 FROM agentRegistry WHERE registry_id = 'localUpdateCount'`)
    .get() as { int_1: number }
  const usn = Number(int_1) + 1
  db.prepare(
    `UPDATE agentRegistry SET int_1 = ?, updated_at = ? WHERE registry_id = 'localUpdateCount'`,
  ).run(usn, stamp)
  return usn
}

// rekordbox picks row IDs at random, so a generated one can collide with a row already
// there; drawing again until it is free is what rekordbox and pyrekordbox both do.
export function unusedRowId(db: Db, table: string, next: () => string): string {
  const taken = db.prepare(`SELECT 1 FROM ${table} WHERE ID = ?`)
  for (;;) {
    const id = next()
    if (!taken.get(id)) return id
  }
}
