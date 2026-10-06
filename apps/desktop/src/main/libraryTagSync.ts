export interface LibraryTagFlushers {
  traktor: () => Promise<unknown>
  rekordbox: () => Promise<unknown>
  engine: () => Promise<unknown>
  warn: (library: string, error: unknown) => void
}

// The libraries are independent and the files are already correct by now, so one throwing
// (a failed Activity row, an SQL error mid-write) must neither skip the next nor reject
// back to the renderer.
export async function syncLibraryTags(flushers: LibraryTagFlushers): Promise<void> {
  for (const library of ['traktor', 'rekordbox', 'engine'] as const) {
    try {
      await flushers[library]()
    } catch (error) {
      flushers.warn(library, error)
    }
  }
}
