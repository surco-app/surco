export interface LibraryTagFlushers {
  traktor: () => Promise<unknown>
  rekordbox: () => Promise<unknown>
  engine: () => Promise<unknown>
  warn: (library: string, error: unknown) => void
}

let flushChain: Promise<unknown> = Promise.resolve()

// One library write at a time across the app: a conversion run's flush and a review's
// sync touch the same databases, and Engine's m.db is rewritten outside engineLibrary's
// own queue, under the same temp names.
export function serialLibraryFlush<T>(task: () => Promise<T>): Promise<T> {
  const run = flushChain.then(task, task)
  flushChain = run.catch(() => undefined)
  return run
}

// The libraries are independent and the files are already correct by now, so one throwing
// (a failed Activity row, an SQL error mid-write) must neither skip the next nor reject
// back to the renderer.
export function syncLibraryTags(flushers: LibraryTagFlushers): Promise<void> {
  return serialLibraryFlush(async () => {
    for (const library of ['traktor', 'rekordbox', 'engine'] as const) {
      try {
        await flushers[library]()
      } catch (error) {
        flushers.warn(library, error)
      }
    }
  })
}
