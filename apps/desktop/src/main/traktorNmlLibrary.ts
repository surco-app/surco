import { copyFile, readFile, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import { renameWithRetry } from './renameRetry'
import { readEmbeddedCover } from './tags'
import { refreshCachedCoverArt } from './traktorCoverCache'
import {
  applyPatches,
  detachedOutputPaths,
  matchedPatchCount,
  type NmlPatch,
  refreshedCoverIds,
} from './traktorNml'
import { isTraktorRunning } from './traktorProcess'

// Writes converted tracks back into the user's real collection.nml — the whole Traktor
// library (every track, playlist and play-count) in one file. Best-effort like tags.ts's
// cue handling: the audio conversion already succeeded on disk by the time this runs, so
// nothing here throws to its caller. Every failure path returns a reason instead.

// One backup, always the same name, overwritten on every write — the same bargain
// engineLibrary.ts strikes with m.db.surco-backup. Dated copies were the first shape,
// but every lone conversion writes the collection, so converting three tracks one by
// one left three .bak files beside it: clutter in the user's own folder for something
// he only wants as a safety net. What he can lose is the state before the previous
// write, which the write he is undoing had already replaced anyway.
const BACKUP_SUFFIX = '.surco-backup'

// How far ahead of the collection a detached conversion's timestamp is placed. Seconds
// rather than milliseconds because the comparison has to survive a filesystem that
// stores whole-second mtimes, and because Traktor reads it on a later launch, not now.
const MTIME_LEAD_MS = 5000

export interface SyncResult {
  written: boolean
  matched: number
  reason?: 'traktor-running' | 'backup-failed' | 'no-matches' | 'unreadable' | 'write-failed'
}

export async function syncCollection(nmlPath: string, patches: NmlPatch[]): Promise<SyncResult> {
  // Traktor loads collection.nml once at launch and rewrites it whole on quit, so a
  // write while it's open is invisible until restart at best, silently reverted at
  // worst — see traktorProcess.ts. Checked again below, right before the swap.
  if (await isTraktorRunning()) {
    return { written: false, matched: 0, reason: 'traktor-running' }
  }

  let original: string
  try {
    original = await readFile(nmlPath, 'utf8')
  } catch {
    return { written: false, matched: 0, reason: 'unreadable' }
  }

  const patched = applyPatches(original, patches)
  if (patched === original) {
    // A patch that matched nothing is the normal "Traktor doesn't have this track"
    // case, not a failure — no backup, no write, disk untouched.
    return { written: false, matched: 0, reason: 'no-matches' }
  }

  try {
    await copyFile(nmlPath, `${nmlPath}${BACKUP_SUFFIX}`)
  } catch {
    // No backup, no write. A write without a recoverable copy next to it is the one
    // outcome this whole module exists to rule out.
    return { written: false, matched: 0, reason: 'backup-failed' }
  }

  // Traktor can have launched during the read/backup above; check again right before
  // the swap so the vulnerable window shrinks to the rename itself. Mirrors
  // engineLibrary.ts's writeBatch, which checks Engine DJ at the same two points.
  if (await isTraktorRunning()) {
    return { written: false, matched: 0, reason: 'traktor-running' }
  }

  // Write-then-rename so a crash mid-write can never leave a truncated collection.
  // The conversion on disk already succeeded by the time we get here (see the module
  // comment), so a write/rename failure — disk full, read-only volume — must return a
  // reason like every other failure path here, not throw past a caller that already
  // told the DJ their files were converted.
  const tmp = `${nmlPath}.surco-tmp`
  try {
    await writeFile(tmp, patched)
    await renameWithRetry(tmp, nmlPath)
  } catch {
    // The backup taken above is what actually protects the collection; the leftover
    // tmp file is not — left behind, it would keep shadowing every later sync at the
    // same path, so clear it before reporting the failure. Best-effort: if even the
    // unlink fails, the reason returned still stands.
    await unlink(tmp).catch(() => {})
    return { written: false, matched: 0, reason: 'write-failed' }
  }

  // Only now the collection is actually on disk. Traktor draws the library's artwork
  // from its own thumbnail cache, never from the audio file, so a converted track keeps
  // showing the old picture until those cached files carry the new one — clearing
  // COVERARTID would only send it back to the same stale cache (see
  // traktorCoverCache.ts). Read off `original`, which still has the ids, and after the
  // rename so a sync that never landed leaves a matching cache alone.
  refreshCachedCoverArt(nmlPath, refreshedCoverIds(original, patches), readEmbeddedCover)

  // A conversion that coexists with its source just had the inherited AUDIO_ID and
  // COVERARTID stripped, so Traktor knows no artwork for it and has nothing cached to
  // refresh above. It builds an independent id and cache entry only when it finds the
  // audio newer than the collection it just read, so without this the converted track
  // shows no cover at all rather than the one embedded in the file.
  //
  // Ahead of the NML's own timestamp, not merely "now": the collection was written
  // microseconds earlier, and on a filesystem with coarse timestamps the two would
  // otherwise land on the same second and Traktor would not count the file as newer.
  try {
    const writtenAt = (await stat(nmlPath)).mtimeMs
    const newer = new Date(Math.max(Date.now(), writtenAt) + MTIME_LEAD_MS)
    for (const file of detachedOutputPaths(original, patches)) {
      // Per file: a read-only or missing output must not stop the rest from being
      // touched, and the collection on disk is already correct either way.
      await utimes(file, newer, newer).catch(() => {})
    }
  } catch {
    // The collection is written and the sync succeeded. A failure to read its timestamp
    // only postpones Traktor noticing the new cover; it must not report the sync failed.
  }

  return { written: true, matched: matchedPatchCount(original, patches) }
}
