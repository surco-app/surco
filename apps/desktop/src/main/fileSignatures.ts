// The modification date Surco last saw for each file, kept across launches. Every analysis
// cache is keyed by path + date, and asking a NAS for 2000 dates before a list can show its
// tags took 11-19 s (measured 01/11); the dates seen last time answer at once. Each one served
// that way is checked against the disk in the background, once per session, and a file found
// changed or gone is reported so its row is read again.
export interface FileSignatures {
  // The remembered date, or the disk's when there is none.
  mtimeOf: (path: string) => Promise<number>
  // Always the disk's date: for work about to be computed or written from the file now.
  fresh: (path: string) => Promise<number>
  // Whether the file changed or went away since its date was last seen; asked before a write.
  changed: (path: string) => Promise<boolean>
  flush: () => void
}

interface Deps {
  load: () => Record<string, number>
  save: (dates: Record<string, number>) => void
  stat: (path: string) => Promise<{ mtimeMs: number }>
  // The background check's way of asking: a queue that never floods a NAS.
  verifyStat: (path: string) => Promise<{ mtimeMs: number }>
  onChanged: (paths: string[]) => void
  defer: (run: () => Promise<void>) => void
}

const isGone = (error: unknown): boolean => {
  const code = (error as { code?: string } | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

export function createFileSignatures(deps: Deps): FileSignatures {
  const dates = new Map(Object.entries(deps.load()))
  const verified = new Set<string>()
  const queued = new Set<string>()
  let scheduled = false
  let dirty = false

  const record = (path: string, mtimeMs: number): boolean => {
    const before = dates.get(path)
    verified.add(path)
    if (before === mtimeMs) return false
    dates.set(path, mtimeMs)
    dirty = true
    return before !== undefined
  }

  const forget = (path: string): void => {
    dates.delete(path)
    dirty = true
    verified.add(path)
  }

  const verify = async (): Promise<void> => {
    scheduled = false
    const paths = [...queued]
    queued.clear()
    const changed: string[] = []
    await Promise.all(
      paths.map(async (path) => {
        try {
          if (record(path, (await deps.verifyStat(path)).mtimeMs)) changed.push(path)
        } catch (error) {
          if (!isGone(error)) return
          forget(path)
          changed.push(path)
        }
      }),
    )
    if (changed.length > 0) deps.onChanged(changed)
  }

  const checkLater = (path: string): void => {
    if (verified.has(path) || queued.has(path)) return
    queued.add(path)
    if (scheduled) return
    scheduled = true
    deps.defer(verify)
  }

  return {
    async mtimeOf(path) {
      const known = dates.get(path)
      if (known === undefined) {
        const mtimeMs = (await deps.stat(path)).mtimeMs
        record(path, mtimeMs)
        return mtimeMs
      }
      checkLater(path)
      return known
    },
    async fresh(path) {
      const mtimeMs = (await deps.stat(path)).mtimeMs
      if (record(path, mtimeMs)) deps.onChanged([path])
      return mtimeMs
    },
    async changed(path) {
      try {
        return record(path, (await deps.stat(path)).mtimeMs)
      } catch (error) {
        if (!isGone(error)) throw error
        forget(path)
        return true
      }
    },
    flush() {
      if (!dirty) return
      dirty = false
      deps.save(Object.fromEntries(dates))
    },
  }
}
