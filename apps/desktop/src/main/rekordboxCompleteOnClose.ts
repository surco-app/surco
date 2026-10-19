import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import log from 'electron-log/main'
import { cueChanges, findDrops, isEmptyChange } from '../shared/cueRules'
import { rekordboxShareDir } from './rekordboxArtwork'
import { readTrackCues } from './rekordboxCues'
import { withCollection } from './rekordboxPlaylistsIpc'
import type { RekordboxQueue } from './rekordboxQueue'
import type { CuesOp } from './rekordboxQueueOps'

type Db = InstanceType<typeof Database>

export function completableOps(
  db: Db,
  shareDir: string,
  newId: () => string = randomUUID,
): CuesOp[] {
  const ids = (
    db
      .prepare(
        `SELECT ContentID FROM djmdCue WHERE coalesce(rb_local_deleted, 0) = 0
          GROUP BY ContentID HAVING sum(CASE WHEN Kind <> 0 THEN 1 ELSE 0 END) = 0`,
      )
      .all() as { ContentID: string }[]
  ).map((r) => String(r.ContentID))
  const info = db.prepare(
    `SELECT FolderPath, Title FROM djmdContent WHERE ID = ? AND coalesce(rb_local_deleted, 0) = 0`,
  )
  const ops: CuesOp[] = []
  for (const contentId of ids) {
    const row = info.get(contentId) as { FolderPath: string; Title: string | null } | undefined
    if (!row) continue
    const read = readTrackCues(db, shareDir, contentId, { wave: false })
    if (!read?.analysed) continue
    const drops = findDrops(
      read.cues.map((c) => c.ms),
      [],
    )
    const out = cueChanges(
      read.cues,
      drops,
      drops,
      read.grid.map((b) => b.ms),
      read.strong,
    )
    if (out.status !== 'plan' || isEmptyChange(out.changes)) continue
    ops.push({
      id: newId(),
      kind: 'cues',
      contentId,
      path: row.FolderPath,
      label: row.Title || row.FolderPath,
      drops,
      previousDrops: drops,
      fingerprint: read.fingerprint,
    })
  }
  return ops
}

export function completeOnClose(deps: {
  enabled: () => boolean
  collection: () => string
  queue: Pick<RekordboxQueue, 'enqueue' | 'cuesOp' | 'state'>
  newId?: () => string
}): void {
  if (!deps.enabled()) return
  const path = deps.collection()
  if (!path) return
  const state = deps.queue.state()
  if (state.halted || state.elsewhere) return
  try {
    const ops = withCollection(
      path,
      (db) => completableOps(db, rekordboxShareDir(path), deps.newId),
      [],
    ).filter((op) => !deps.queue.cuesOp(op.contentId))
    if (ops.length > 0) deps.queue.enqueue(ops)
  } catch (err) {
    log.warn(`rekordbox complete on close skipped: ${String(err)}`)
  }
}
