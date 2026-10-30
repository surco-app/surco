import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import log from 'electron-log/main'
import { backupOf } from './libraryBackups'
import type { CopyReason } from '../shared/types'
import { takeCopy } from './libraryHistory'
import { openRekordboxDb } from './rekordboxDb'

// A copy keeps the mode of what it copied, and rekordbox can leave its files read-only.
// Copied over in place, last time's read-only copy refused the next one, and with it every
// write after the first. Removed first and left owner-writable, a copy never blocks the
// next.
export async function writeBackup(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true })
  await rm(to, { force: true })
  await copyFile(from, to)
  await chmod(to, (await stat(to)).mode | 0o200)
}

// One dated copy of the collection per momento (a conversion run, a cue write...), taken
// before the first write and left alone until the next momento begins.
//
// It exists because the per-write backup cannot do this job. That one is overwritten
// before every track, so after a 300-track run it holds the collection as it was before
// track 300 — one write from the end. The two answer different questions: the per-write
// copy undoes a write that died halfway, this one puts the collection back the way it was
// before the run started. A DJ who converts 300 tracks and then decides the whole batch
// was a mistake needs this one.
//
// Copies go into the library history (libraryHistory.ts), which keeps the last few dated
// ones per collection, so an older state survives the next momento.
export interface SessionBackup {
  // Copies the collection if this momento has not already done so. Throws if the copy
  // fails — the caller must not write without one.
  ensure: (collectionPath: string) => Promise<void>
  begin: (reason: CopyReason) => void
  beginLoose: (collectionPath: string) => void
  inRunFlush: (active: boolean) => void
  failed: () => ReadonlySet<string>
}

interface Momento {
  reason: CopyReason
  // Per collection, not one flag: tracking a single "done" would leave a second collection
  // in the same momento with no copy at all.
  copied: Set<string>
  taking: Map<string, Promise<void>>
}

const momento = (reason: CopyReason): Momento => ({
  reason,
  copied: new Set(),
  taking: new Map(),
})

export function createSessionBackup(deps: {
  take?: typeof takeCopy
  companionsOf?: (collectionPath: string) => string[]
  skip?: (collectionPath: string) => boolean
}): SessionBackup {
  const take = deps.take ?? takeCopy
  const companionsOf = deps.companionsOf ?? (() => [])
  const skip = deps.skip ?? (() => false)
  const loose = new Map<string, Momento>()
  const waiting = new Map<string, Momento>()
  const failures = new Set<string>()
  let current = momento('run')
  let run: Momento | null = null
  let flushingRun = false

  const copyInto = async (m: Momento, collectionPath: string): Promise<void> => {
    try {
      await take(collectionPath, companionsOf(collectionPath), m.reason)
    } catch (err) {
      failures.add(collectionPath)
      throw err
    }
    failures.delete(collectionPath)
    // Recorded only after the copy lands, so a failure leaves the next write trying again
    // rather than writing into a collection with nothing behind it.
    m.copied.add(collectionPath)
    if (m.reason !== 'playlists') loose.delete(collectionPath)
  }

  return {
    async ensure(collectionPath: string): Promise<void> {
      if (skip(collectionPath)) return
      const m = (flushingRun && run) || waiting.get(collectionPath) || current
      if (m.copied.has(collectionPath)) return
      const inFlight = m.taking.get(collectionPath)
      if (inFlight) return inFlight
      const taking = copyInto(m, collectionPath).finally(() => m.taking.delete(collectionPath))
      m.taking.set(collectionPath, taking)
      return taking
    },
    begin(next: CopyReason): void {
      current = momento(next)
      waiting.clear()
      if (next === 'run') run = current
    },
    beginLoose(collectionPath: string): void {
      let m = loose.get(collectionPath)
      if (!m) {
        m = momento('playlists')
        loose.set(collectionPath, m)
      }
      waiting.set(collectionPath, m)
    },
    inRunFlush(active: boolean): void {
      flushingRun = active
    },
    failed: () => failures,
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
      `rekordbox ${collectionPath} not restored: its -wal still holds frames; the backups in ${dirname(backupOf(collectionPath, 'backup'))} are intact`,
    )
    return false
  }
  try {
    await copyFile(backupOf(collectionPath, 'backup'), collectionPath)
    return true
  } catch (err) {
    log.error(`rekordbox ${collectionPath} could not be restored: ${String(err)}`)
    return false
  }
}
