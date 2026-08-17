import { type FSWatcher, watch } from 'node:fs'
import { stat } from 'node:fs/promises'
import { collectAudio } from './expand'

// Of the paths the user dropped or picked, only directories are worth watching: a folder
// can grow when tracks are copied into it later, a single dropped file cannot. We filter
// here rather than in the renderer because main is the only side that sees the original
// drop before expandPaths flattens folders to their files.
export async function dirRoots(paths: string[]): Promise<string[]> {
  const flags = await Promise.all(
    paths.map(async (p) => {
      const info = await stat(p).catch(() => null)
      return info?.isDirectory() ? p : null
    }),
  )
  return flags.filter((p): p is string => p !== null)
}

// Watches the folders a crate was loaded from and, when their contents change, hands back
// each folder's full current audio list. The renderer diffs that against what it already
// holds to surface "N new tracks" — the watcher itself stays diff-free so its only state is
// the set of OS watches, which makes teardown a simple close().
//
// fs.watch with { recursive } is native on macOS (FSEvents) and Windows (ReadDirectoryW),
// the two platforms we ship, so a single watch covers nested album subfolders. Editors and
// USB/network copies fire a burst of events per file written, so a per-root debounce
// collapses each burst into one rescan instead of stat-walking the tree dozens of times.
//
// The OS watch is fast but not exhaustive: it drops events on network volumes and for apps
// that write through a temp file renamed deep in a subfolder (Soulseek). A low-frequency
// poll re-scans every watched root on an interval as a safety net — the renderer diffs each
// report, so a sweep that finds nothing new is a silent no-op.
//
// That sweep is not free, though: it is one round trip per directory, and a real 560-folder
// crate on an SMB share costs ~20s of them even warm (see expand.ts). At a flat interval
// that is a third of every minute spent re-reading a folder that almost never changes, for
// as long as the app is open. So the interval backs off while sweeps come up empty, and any
// find — poll or OS watch — drops it back to the base rate.

// How long to wait before the next sweep, given how many in a row found nothing. Doubling
// rather than a fixed slow rate: a crate being filled right now stays responsive, while one
// that has been quiet for ten minutes is almost certainly going to be quiet for the next
// ten. Capped at 10× the base so a quiet crate never drifts into effectively unwatched —
// the Soulseek download this exists to catch still has to surface on its own.
export function nextPollMs(emptySweeps: number, baseMs: number): number {
  return Math.min(baseMs * 2 ** emptySweeps, baseMs * 10)
}

export class FolderWatcher {
  private watches = new Map<string, FSWatcher>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private poll: ReturnType<typeof setTimeout> | null = null
  // Consecutive sweeps that turned up nothing new anywhere, which is what nextPollMs
  // spaces the next one on. Reset by any find, including one the OS watch reported.
  private emptySweeps = 0
  // The file count last reported per root — enough to tell "this sweep found something"
  // from "nothing moved" without duplicating the renderer's own diff. A rename inside a
  // root keeps the count and is missed here, but the OS watch catches those: this only
  // decides how soon to look again, never what the renderer is told.
  private counts = new Map<string, number>()
  // close() can land while a sweep is still walking the tree. Its own timer is cleared,
  // but the in-flight sweep would re-arm one when it settles and the crate would keep
  // reporting after teardown — the leak the close test exists to catch, just too late
  // for it to see.
  private closed = false

  constructor(
    private onChange: (root: string, files: string[]) => void,
    private debounceMs = 500,
    private pollMs = 60_000,
  ) {}

  watch(roots: string[]): void {
    // Reopens an instance a previous close() shut: folders:unwatch closes the window's
    // watcher but leaves it in the map, so loading the next crate reaches this same
    // object. Without this it would stay silent for the rest of the session.
    this.closed = false
    for (const root of roots) {
      if (this.watches.has(root)) continue
      try {
        const w = watch(root, { recursive: true }, () => this.schedule(root))
        // A vanished or permission-denied folder must not crash the main process; a dead
        // watch just means that crate stops auto-detecting, which is acceptable.
        w.on('error', () => this.drop(root))
        this.watches.set(root, w)
      } catch {
        // watch() throws synchronously if the path is already gone — ignore it.
      }
    }
    this.startPoll()
  }

  private startPoll(): void {
    if (this.poll || this.watches.size === 0) return
    this.armPoll()
  }

  // A re-armed timeout rather than setInterval, because the wait changes with each
  // outcome. Armed only after the previous sweep settles, so a slow network walk can
  // never overlap itself the way a fixed interval could.
  private armPoll(): void {
    this.poll = setTimeout(
      () => {
        void this.sweep().finally(() => {
          if (!this.closed && this.watches.size > 0) this.armPoll()
          else this.poll = null
        })
      },
      nextPollMs(this.emptySweeps, this.pollMs),
    )
    // The timer must not keep the process alive on its own; the window's lifetime decides
    // when watching ends (unref is a no-op in the renderer-less test harness).
    this.poll.unref?.()
  }

  private async sweep(): Promise<void> {
    let found = false
    await Promise.all(
      [...this.watches.keys()].map((root) =>
        collectAudio(root)
          .then((files) => {
            if (files.length !== this.counts.get(root)) found = true
            this.report(root, files)
          })
          .catch(() => {}),
      ),
    )
    // Counted per sweep, not per root: one root gaining a file means the crate is being
    // worked on, so every root goes back to being checked at the base rate.
    this.emptySweeps = found ? 0 : this.emptySweeps + 1
  }

  // Every report goes through here so the remembered count stays in step with what the
  // renderer was last told, whichever path produced it — and so a walk that was already
  // running when the crate was torn down reports nothing.
  private report(root: string, files: string[]): void {
    if (this.closed) return
    this.counts.set(root, files.length)
    this.onChange(root, files)
  }

  private schedule(root: string): void {
    const pending = this.timers.get(root)
    if (pending) clearTimeout(pending)
    this.timers.set(
      root,
      setTimeout(() => {
        this.timers.delete(root)
        void collectAudio(root)
          .then((files) => {
            // The OS saw something move, so the crate is live: back to the base rate,
            // whatever the poll had backed off to.
            this.emptySweeps = 0
            this.report(root, files)
          })
          .catch(() => {})
      }, this.debounceMs),
    )
  }

  private drop(root: string): void {
    this.watches.get(root)?.close()
    this.watches.delete(root)
    const pending = this.timers.get(root)
    if (pending) clearTimeout(pending)
    this.timers.delete(root)
    this.counts.delete(root)
  }

  close(): void {
    this.closed = true
    for (const w of this.watches.values()) w.close()
    for (const t of this.timers.values()) clearTimeout(t)
    if (this.poll) clearTimeout(this.poll)
    this.poll = null
    this.watches.clear()
    this.timers.clear()
    this.counts.clear()
    this.emptySweeps = 0
  }
}
