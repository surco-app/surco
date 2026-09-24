import { copyFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import log from 'electron-log/main'
import {
  FILE_TYPES,
  type FindOptions,
  findTrackByPath,
  isAmbiguous,
  openRekordboxDb,
} from './rekordboxDb'
import { isRekordboxRunning } from './rekordboxProcess'

// Moves an existing collection entry onto the file a conversion just produced, so the
// track keeps its ID and therefore its playlists, cues and play history. Writing into a
// library the user cannot rebuild is what shapes everything here: the collection is
// backed up before it is touched, a running rekordbox refuses the write twice over, an
// ambiguous match refuses rather than guesses, and a failed write is rolled back from the
// backup.
//
// Best-effort, like the Traktor and Engine counterparts: the audio conversion has already
// succeeded on disk by the time this runs, so nothing here throws to its caller. Every
// failure path returns a reason instead.

// One backup, always the same name, overwritten on every write — the same bargain
// engineLibrary.ts and traktorNmlLibrary.ts strike. Dated copies would pile up in the
// user's own folder, one per converted track, for something they only want as a safety
// net. rekordbox keeps its own rotating backups beside it as well.
const BACKUP_SUFFIX = '.surco-backup'

export type RepointResult =
  | { written: true; id: string }
  | { written: false; reason: 'no-match' | 'output-missing' | 'unreadable' }
  | { written: false; reason: 'rekordbox-running' | 'backup-failed' | 'write-failed' }
  | { written: false; reason: 'read-only' }
  | { written: false; reason: 'ambiguous'; ids: string[] }

export interface RepointOptions extends FindOptions, RepointBatchOptions {
  // The file the collection points at now, and the one it should point at instead.
  from: string
  to: string
  // Seam for the tests to force the failure that must never be simulated by damaging a
  // real collection: a write that dies halfway. Runs right after this track's row changed.
  onWrite?: () => void
}

// What a whole run shares. Seams for the tests too: a backup that cannot be made defaults
// to the real copy.
export interface RepointBatchOptions {
  backup?: (source: string, destination: string) => Promise<void>
  // Takes the run's single pre-run copy, before the first write. A failure here refuses
  // the write like any other missing backup.
  sessionBackup?: (collectionPath: string) => Promise<void>
}

// rekordbox stores the format as a number, so an entry left on the old code would
// describe the row as a file it no longer is.
function fileTypeFor(path: string): number | null {
  const ext = extname(path).slice(1).toLowerCase()
  return FILE_TYPES[ext] ?? null
}

export async function repointTrack(
  collectionPath: string,
  options: RepointOptions,
): Promise<RepointResult> {
  const { backup, sessionBackup, ...repoint } = options
  const [result] = await repointTracks(collectionPath, [repoint], { backup, sessionBackup })
  return result
}

type Repoint = Omit<RepointOptions, keyof RepointBatchOptions>

// A whole run at once: one check that rekordbox is closed, one read to find every track,
// one backup, one more check, and one write for all of them. Each track used to pay all of
// that on its own, a full copy of the collection (the user's is 56 MB) and two opens
// through the cipher's key derivation, so a run of hundreds of tracks held the main
// process for minutes. Results come back per track, in the order given.
//
// One backup now stands behind the whole run, so the writes go in one transaction and a
// failure restores that backup: no track is ever reported written from a collection that
// was put back.
export async function repointTracks(
  collectionPath: string,
  repoints: Repoint[],
  batch: RepointBatchOptions = {},
): Promise<RepointResult[]> {
  const copy = batch.backup ?? copyFile
  const results: (RepointResult | undefined)[] = repoints.map(() => undefined)
  const pending: { index: number; size: number; fileType: number }[] = []
  for (const [index, { from, to }] of repoints.entries()) {
    // The pair the renderer handed over, logged before any guard runs. A lookup miss can
    // come from the wrong `from` (the renderer named a file rekordbox never had) or from
    // the matching itself, and only seeing both ends tells them apart — three rounds of
    // guessing followed from having neither in the log.
    log.info(`rekordbox repoint attempt: from=${JSON.stringify(from)} to=${JSON.stringify(to)}`)
    // The converted file has to exist before the collection is told to point at it, or
    // the repoint just trades one missing-file "!" for another.
    let size: number
    try {
      size = (await stat(to)).size
    } catch {
      results[index] = { written: false, reason: 'output-missing' }
      continue
    }
    const fileType = fileTypeFor(to)
    if (fileType === null) {
      results[index] = { written: false, reason: 'output-missing' }
      continue
    }
    pending.push({ index, size, fileType })
  }
  // Every track still undecided gets the reason that stopped the run.
  const settle = (result: RepointResult): RepointResult[] => results.map((r) => r ?? result)
  if (pending.length === 0) return settle({ written: false, reason: 'output-missing' })

  // rekordbox holds master.db open through SQLCipher for as long as it runs, so a write
  // underneath it can be lost or can corrupt the file. Checked again below, right before
  // the write, because the app can be launched while this is reading.
  if (await isRekordboxRunning()) return settle({ written: false, reason: 'rekordbox-running' })

  const db = openRekordboxDb(collectionPath)
  if (!db) return settle({ written: false, reason: 'unreadable' })
  const writes: { index: number; id: string; size: number; fileType: number }[] = []
  try {
    for (const p of pending) {
      const repoint = repoints[p.index]
      const match = findTrackByPath(db, repoint.from, repoint)
      // A collection that never had this track is the normal case for a partly-imported
      // library, and nothing — not even a backup — should be written for it.
      if (match === null) results[p.index] = { written: false, reason: 'no-match' }
      else if (isAmbiguous(match))
        results[p.index] = { written: false, reason: 'ambiguous', ids: match.ambiguous }
      else writes.push({ ...p, id: match.id })
    }
  } finally {
    db.close()
  }
  if (writes.length === 0) return settle({ written: false, reason: 'no-match' })

  try {
    // The run's own copy first: it has to describe the collection as it was BEFORE the
    // run. Then the copy the rollback below restores.
    await batch.sessionBackup?.(collectionPath)
    await copy(collectionPath, `${collectionPath}${BACKUP_SUFFIX}`)
  } catch {
    // No backup, no write.
    return settle({ written: false, reason: 'backup-failed' })
  }

  // Second check, after the read and the backup: the vulnerable window is now just the
  // write itself. A user who double-clicks rekordbox while a conversion runs lands here.
  if (await isRekordboxRunning()) return settle({ written: false, reason: 'rekordbox-running' })

  const write = openRekordboxDb(collectionPath)
  if (!write) return settle({ written: false, reason: 'unreadable' })
  try {
    // FolderPath, FileNameL, FileType and FileSize are the four columns a format change
    // invalidates. OrgFolderPath is deliberately not among them: it records where the
    // track originally came from, and in the real collection 846 rows already disagree
    // with the live path while rekordbox runs fine.
    const update = write.prepare(
      `UPDATE djmdContent
          SET FolderPath = ?, FileNameL = ?, FileType = ?, FileSize = ?
        WHERE ID = ?`,
    )
    write.transaction(() => {
      for (const w of writes) {
        const { to, onWrite } = repoints[w.index]
        update.run(to, basename(to), w.fileType, w.size, w.id)
        // Placed after the statement so a test can fail the write once the row has
        // really changed — the only state in which the rollback below is doing anything.
        onWrite?.()
      }
    })()
    for (const w of writes) results[w.index] = { written: true, id: w.id }
    return settle({ written: false, reason: 'no-match' })
  } catch (err) {
    // A collection the process cannot write to is the user's to fix — a permission, a
    // locked volume, a copy restored read-only — and a bare "write failed" does not say
    // that. Separated after hitting it for real: a read-only copy of the live collection
    // reported nothing more useful than a generic failure.
    if (String((err as { code?: unknown })?.code).startsWith('SQLITE_READONLY')) {
      for (const w of writes) results[w.index] = { written: false, reason: 'read-only' }
      return settle({ written: false, reason: 'read-only' })
    }
    // The collection is left exactly as it was found; the backup is the only copy that
    // can guarantee that, so it is put back rather than trusting a half-applied write.
    try {
      await copyFile(`${collectionPath}${BACKUP_SUFFIX}`, collectionPath)
    } catch {
      // The backup is still on disk under its own name for the user to restore by hand.
    }
    for (const w of writes) results[w.index] = { written: false, reason: 'write-failed' }
    return settle({ written: false, reason: 'write-failed' })
  } finally {
    write.close()
  }
}
