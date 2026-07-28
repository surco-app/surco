import { copyFile, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { applyPatches, matchedPatchCount, type NmlPatch } from './traktorNml'
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

  const dir = dirname(nmlPath)
  const backupPath = `${nmlPath}${BACKUP_MARKER}${new Date().toISOString().replace(/:/g, '-')}.bak`
  try {
    await copyFile(nmlPath, backupPath)
  } catch {
    // No backup, no write. A write without a recoverable copy next to it is the one
    // outcome this whole module exists to rule out.
    return { written: false, matched: 0, reason: 'backup-failed' }
  }
  try {
    await rotateBackups(dir, nmlPath)
  } catch {
    // The module's own contract (see the header comment): nothing escapes to the
    // caller uncaught. A readdir failure here (EIO, an unmounted volume) would
    // otherwise propagate out of syncCollection into the unguarded
    // 'process:batch-end' handler and vanish as an unhandled rejection — the DJ
    // sees no activity row at all, neither success nor failure. The backup taken
    // above already protects the collection, so this is safe to treat like any
    // other failure short of the write itself.
    return { written: false, matched: 0, reason: 'write-failed' }
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
    await rename(tmp, nmlPath)
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
