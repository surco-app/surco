import { copyFile, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { applyPatches, type NmlPatch } from './traktorNml'
import { isTraktorRunning } from './traktorProcess'

// Writes converted tracks back into the user's real collection.nml — the whole Traktor
// library (every track, playlist and play-count) in one file. Best-effort like tags.ts's
// cue handling: the audio conversion already succeeded on disk by the time this runs, so
// nothing here throws to its caller. Every failure path returns a reason instead.

const BACKUP_MARKER = '.surco-'
const MAX_BACKUPS = 10

export interface SyncResult {
  written: boolean
  matched: number
  reason?: 'traktor-running' | 'backup-failed' | 'no-matches' | 'unreadable'
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

  const dir = dirname(nmlPath)
  const backupPath = `${nmlPath}${BACKUP_MARKER}${new Date().toISOString().replace(/:/g, '-')}.bak`
  try {
    await copyFile(nmlPath, backupPath)
  } catch {
    // No backup, no write. A write without a recoverable copy next to it is the one
    // outcome this whole module exists to rule out.
    return { written: false, matched: 0, reason: 'backup-failed' }
  }
  await rotateBackups(dir, nmlPath)

  // Traktor can have launched during the read/backup above; check again right before
  // the swap so the vulnerable window shrinks to the rename itself. Mirrors
  // engineLibrary.ts's writeBatch, which checks Engine DJ at the same two points.
  if (await isTraktorRunning()) {
    return { written: false, matched: 0, reason: 'traktor-running' }
  }

  // Write-then-rename so a crash mid-write can never leave a truncated collection.
  const tmp = `${nmlPath}.surco-tmp`
  await writeFile(tmp, patched)
  await rename(tmp, nmlPath)

  return { written: true, matched: countMatches(original, patches) }
}

// applyPatches doesn't report which patches matched, only the resulting text — and a
// real batch mixes tracks Traktor has with tracks it doesn't. Applying each patch on
// its own against the untouched original and checking for a diff reuses the same
// matching rules (including the AIFF→FLAC base-name fallback) without duplicating
// them, so "matched" never claims a track that was never in the collection.
function countMatches(original: string, patches: NmlPatch[]): number {
  return patches.filter((p) => applyPatches(original, [p]) !== original).length
}

// Rotates only Surco's own backups (the BACKUP_MARKER suffix), never a Traktor backup
// or a file the user happens to have dropped next to the collection. Keeps the 10 most
// recent by filename, which sorts chronologically because the timestamp is ISO-8601.
async function rotateBackups(dir: string, nmlPath: string): Promise<void> {
  const prefix = `${nmlPath.slice(dir.length + 1)}${BACKUP_MARKER}`
  const files = (await readdir(dir))
    .filter((f) => f.startsWith(prefix) && f.endsWith('.bak'))
    .sort()
  const stale = files.slice(0, Math.max(0, files.length - MAX_BACKUPS))
  for (const f of stale) {
    try {
      await unlink(join(dir, f))
    } catch {
      // A backup that can't be deleted just means one extra file survives past the
      // cap — not worth failing the sync over.
    }
  }
}
