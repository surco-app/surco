import { copyFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
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

export interface RepointOptions extends FindOptions {
  // The file the collection points at now, and the one it should point at instead.
  from: string
  to: string
  // Seams for the tests to force the two failures that must never be simulated by
  // damaging a real collection: a backup that cannot be made, and a write that dies
  // halfway. Both default to the real thing.
  backup?: (source: string, destination: string) => Promise<void>
  onWrite?: () => void
  // Takes the run's single pre-run copy, on the first track that reaches the write. A
  // failure here refuses the write like any other missing backup.
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
  const { from, to } = options
  const copy = options.backup ?? copyFile

  // The converted file has to exist before the collection is told to point at it, or the
  // repoint just trades one missing-file "!" for another.
  let size: number
  try {
    size = (await stat(to)).size
  } catch {
    return { written: false, reason: 'output-missing' }
  }

  const fileType = fileTypeFor(to)
  if (fileType === null) return { written: false, reason: 'output-missing' }

  // rekordbox holds master.db open through SQLCipher for as long as it runs, so a write
  // underneath it can be lost or can corrupt the file. Checked again below, right before
  // the write, because the app can be launched while this is reading.
  if (await isRekordboxRunning()) return { written: false, reason: 'rekordbox-running' }

  const db = openRekordboxDb(collectionPath)
  if (!db) return { written: false, reason: 'unreadable' }

  let match: ReturnType<typeof findTrackByPath>
  try {
    match = findTrackByPath(db, from, options)
  } finally {
    db.close()
  }

  // A collection that never had this track is the normal case for a partly-imported
  // library, and nothing — not even a backup — should be written for it.
  if (match === null) return { written: false, reason: 'no-match' }
  if (isAmbiguous(match)) return { written: false, reason: 'ambiguous', ids: match.ambiguous }

  try {
    // The run's own copy first, and only on the first track that gets this far: it has to
    // describe the collection as it was BEFORE the run, which is exactly what the
    // per-write copy below cannot do once a second track overwrites it.
    await options.sessionBackup?.(collectionPath)
    await copy(collectionPath, `${collectionPath}${BACKUP_SUFFIX}`)
  } catch {
    // No backup, no write.
    return { written: false, reason: 'backup-failed' }
  }

  // Second check, after the read and the backup: the vulnerable window is now just the
  // write itself. A user who double-clicks rekordbox while a conversion runs lands here.
  if (await isRekordboxRunning()) return { written: false, reason: 'rekordbox-running' }

  const write = openRekordboxDb(collectionPath)
  if (!write) return { written: false, reason: 'unreadable' }
  try {
    // FolderPath, FileNameL, FileType and FileSize are the four columns a format change
    // invalidates. OrgFolderPath is deliberately not among them: it records where the
    // track originally came from, and in the real collection 846 rows already disagree
    // with the live path while rekordbox runs fine.
    write
      .prepare(
        `UPDATE djmdContent
            SET FolderPath = ?, FileNameL = ?, FileType = ?, FileSize = ?
          WHERE ID = ?`,
      )
      .run(to, basename(to), fileType, size, match.id)
    // Placed after the statement so a test can fail the write once the row has really
    // changed — the only state in which the rollback below is doing anything. Failing
    // before it would leave the file untouched and let a missing rollback pass unnoticed.
    options.onWrite?.()
    return { written: true, id: match.id }
  } catch (err) {
    // A collection the process cannot write to is the user's to fix — a permission, a
    // locked volume, a copy restored read-only — and a bare "write failed" does not say
    // that. Separated after hitting it for real: a read-only copy of the live collection
    // reported nothing more useful than a generic failure.
    if (String((err as { code?: unknown })?.code).startsWith('SQLITE_READONLY')) {
      return { written: false, reason: 'read-only' }
    }
    // The collection is left exactly as it was found; the backup is the only copy that
    // can guarantee that, so it is put back rather than trusting a half-applied write.
    try {
      await copyFile(`${collectionPath}${BACKUP_SUFFIX}`, collectionPath)
    } catch {
      // The backup is still on disk under its own name for the user to restore by hand.
    }
    return { written: false, reason: 'write-failed' }
  } finally {
    write.close()
  }
}
