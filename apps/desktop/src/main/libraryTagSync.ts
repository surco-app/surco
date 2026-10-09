import type { LibraryTagSync, LibraryTagSyncReport } from '../shared/types'
import type { FlushResult } from './libraryRepointFlush'

export interface LibraryTagFlushers {
  traktor: () => Promise<LibraryTagSync>
  rekordbox: () => Promise<LibraryTagSync>
  engine: () => Promise<LibraryTagSync>
  warn: (library: string, error: unknown) => void
}

export function tagSyncOf(result: FlushResult, runningReason: string): LibraryTagSync {
  if (result.blocked === runningReason) return { outcome: 'open' }
  if (result.blocked === 'collection-missing') return { outcome: 'missing' }
  if (result.blocked) return { outcome: 'failed' }
  return result.written > 0 ? { outcome: 'updated', count: result.written } : { outcome: 'nothing' }
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
// back to the renderer. Each library's outcome goes back instead, failure included.
export function syncLibraryTags(flushers: LibraryTagFlushers): Promise<LibraryTagSyncReport> {
  return serialLibraryFlush(async () => {
    const report = {} as LibraryTagSyncReport
    for (const library of ['traktor', 'rekordbox', 'engine'] as const) {
      try {
        report[library] = await flushers[library]()
      } catch (error) {
        flushers.warn(library, error)
        report[library] = { outcome: 'failed' }
      }
    }
    return report
  })
}
