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
export class FolderWatcher {
  private watches = new Map<string, FSWatcher>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private onChange: (root: string, files: string[]) => void,
    private debounceMs = 500,
  ) {}

  watch(roots: string[]): void {
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
  }

  private schedule(root: string): void {
    const pending = this.timers.get(root)
    if (pending) clearTimeout(pending)
    this.timers.set(
      root,
      setTimeout(() => {
        this.timers.delete(root)
        void collectAudio(root)
          .then((files) => this.onChange(root, files))
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
  }

  close(): void {
    for (const w of this.watches.values()) w.close()
    for (const t of this.timers.values()) clearTimeout(t)
    this.watches.clear()
    this.timers.clear()
  }
}
