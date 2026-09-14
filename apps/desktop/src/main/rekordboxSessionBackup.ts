import { copyFile } from 'node:fs/promises'

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
  const copy = deps.copy ?? copyFile
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
