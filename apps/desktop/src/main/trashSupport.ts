import { statfsSync } from 'node:fs'
import { dirname } from 'node:path'

// Filesystem type numbers that keep a deleted file in a Trash. Measured 15/09 on the
// user's machine: home, /tmp and /Volumes/Macintosh HD all report 26 (apfs) while their
// NAS reports 30 (smbfs), where macOS deletes outright.
//
// An allow-list rather than a block-list of network types: a filesystem nobody anticipated
// then reads as "no promise", which is the safe direction. Getting this wrong towards
// "recoverable" is what costs a file — it already did once, when a dialog promised a Trash
// the NAS does not have.
const KEEPS_TRASH: ReadonlySet<number> = new Set([
  26, // apfs
  23, // hfs
  17, // exfat, which keeps a per-volume .Trashes
])

interface TrashSupportDeps {
  statfs: (path: string) => { type: number }
}

// Whether deleting this file can be described to the user as recoverable.
//
// Replaces a path-shaped guess that treated everything under /Volumes as unsafe — wrong
// for /Volumes/Macintosh HD, which is the local disk. The filesystem is asked directly
// instead, and anything unanswerable counts as no promise.
export function volumeKeepsTrash(
  path: string,
  deps: TrashSupportDeps = { statfs: statfsSync },
): boolean {
  if (!path) return false
  // The file may already be gone by the time a caller asks (a failed delete, a stale
  // offer), and its folder sits on the same volume, so one step up still answers.
  for (const probe of [path, dirname(path)]) {
    try {
      return KEEPS_TRASH.has(deps.statfs(probe).type)
    } catch {
      // Unreadable or missing: try the parent, then give up into the cautious answer.
    }
  }
  return false
}
