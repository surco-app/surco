import { existsSync } from 'node:fs'
import { chmod, copyFile, rm, stat } from 'node:fs/promises'
import log from 'electron-log/main'
import { openRekordboxDb } from './rekordboxDb'

const BACKUP_SUFFIX = '.surco-backup'

// A copy keeps the mode of what it copied, and rekordbox can leave its files read-only.
// Copied over in place, last time's read-only copy refused the next one, and with it every
// write after the first. Removed first and left owner-writable, a copy never blocks the
// next.
export async function writeBackup(from: string, to: string): Promise<void> {
  await rm(to, { force: true })
  await copyFile(from, to)
  await chmod(to, (await stat(to)).mode | 0o200)
}

// One copy of the collection per conversion run, taken before the first write and left
// alone afterwards.
//
// It exists because the per-write backup cannot do this job. That one is overwritten
// before every track, so after a 300-track run it holds the collection as it was before
// track 300 — one write from the end. The two answer different questions: the per-write
// copy undoes a write that died halfway, this one puts the collection back the way it was
// before the run started. A DJ who converts 300 tracks and then decides the whole batch
// was a mistake needs this one.
//
// Overwritten on each new run rather than dated: the user's collection is 56 MB, and a
// dated copy per run would pile up in their own folder for something they want as a
// safety net, not an archive. rekordbox keeps its own three rotating backups besides.
const SESSION_SUFFIX = '.surco-session'

export interface SessionBackup {
  // Copies the collection if this run has not already done so. Throws if the copy fails —
  // the caller must not write without one.
  ensure: (collectionPath: string) => Promise<void>
  // Ends the run, so the next one takes its own fresh copy.
  reset: () => void
}

export function createSessionBackup(deps: {
  copy?: (from: string, to: string) => Promise<void>
}): SessionBackup {
  const copy = deps.copy ?? writeBackup
  // Per collection, not one flag: tracking a single "done" would leave a second collection
  // in the same run with no pre-run copy at all.
  const done = new Set<string>()
  return {
    async ensure(collectionPath: string): Promise<void> {
      if (done.has(collectionPath)) return
      // Recorded only after the copy lands, so a failure leaves the next track trying
      // again rather than writing into a collection with nothing behind it.
      await copy(collectionPath, `${collectionPath}${SESSION_SUFFIX}`)
      done.add(collectionPath)
    },
    reset(): void {
      done.clear()
    },
  }
}

// The collection is in WAL mode (measured), so committed changes can still sit in
// master.db-wal. Folding them into master.db first is what makes a copy of master.db a
// complete backup; it changes nothing rekordbox would see. A connection still reading an
// older snapshot blocks the fold, and SQLite reports that only in the result (busy, or
// fewer frames checkpointed than the log holds), never by throwing: then there is no
// complete backup, and no write.
export function checkpointCollection(collectionPath: string): void {
  const db = openRekordboxDb(collectionPath)
  if (!db) throw new Error('rekordbox collection could not be opened')
  try {
    foldWal(db)
  } finally {
    db.close()
  }
}

export function foldWal(db: NonNullable<ReturnType<typeof openRekordboxDb>>): void {
  // Synchronous in the main process: a reader that blocks the fold must answer quickly
  // instead of freezing the window for the default 5 s busy wait.
  db.pragma('busy_timeout = 250')
  const [result] = db.pragma('wal_checkpoint(TRUNCATE)') as {
    busy: number
    log: number
    checkpointed: number
  }[]
  if (result.busy !== 0 || result.log !== result.checkpointed) {
    throw new Error('rekordbox collection WAL could not be folded into master.db')
  }
}

// The last resort, for a collection whose state after a failure is unknown (a rollback
// that itself failed). Called with every connection of Surco's closed. A -wal with frames
// still beside master.db would be replayed by SQLite over the copied-back file, mixing
// the two; then nothing is overwritten and the copies stay on disk for the user.
export async function restoreCollection(collectionPath: string): Promise<boolean> {
  const wal = `${collectionPath}-wal`
  if (existsSync(wal) && (await stat(wal)).size > 0) {
    log.error(
      `rekordbox ${collectionPath} not restored: its -wal still holds frames; the backups ${BACKUP_SUFFIX} and .surco-session are intact`,
    )
    return false
  }
  try {
    await copyFile(`${collectionPath}${BACKUP_SUFFIX}`, collectionPath)
    return true
  } catch (err) {
    log.error(`rekordbox ${collectionPath} could not be restored: ${String(err)}`)
    return false
  }
}
