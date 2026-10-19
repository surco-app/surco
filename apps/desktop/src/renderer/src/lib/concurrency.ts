// Runs fn over items with at most `limit` promises in flight at once, returning
// results in input order. Dropping a folder fires one readTags + readCover per
// file; without a cap that floods the main process with taglib/ffprobe spawns.
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// The same cap, shared by every caller of the returned run: work beyond `limit` waits its
// turn in arrival order. For a cap that must hold across calls, which mapWithConcurrency's
// per-call pool does not.
export function createConcurrencyLimit(limit: number): <R>(task: () => Promise<R>) => Promise<R> {
  let active = 0
  const waiting: (() => void)[] = []
  const release = (): void => {
    const next = waiting.shift()
    if (next) next()
    else active--
  }
  return async (task) => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve))
    else active++
    try {
      return await task()
    } finally {
      release()
    }
  }
}
