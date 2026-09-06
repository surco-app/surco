import { copyFile, readFile, unlink, writeFile } from 'node:fs/promises'
import { renameWithRetry } from './renameRetry'
import { applyPatches, matchedPatchCount, type NmlPatch } from './traktorNml'
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

  return { written: true, matched: matchedPatchCount(original, patches) }
}
