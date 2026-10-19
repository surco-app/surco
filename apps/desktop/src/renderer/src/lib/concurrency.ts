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

export interface PriorityLimit {
  run<R>(key: string, task: () => Promise<R>): Promise<R>
  prioritize(keys: readonly string[]): void
}

export function createPriorityLimit(limit: number): PriorityLimit {
  let active = 0
  let waiting: { key: string; start: () => void }[] = []
  const release = (): void => {
    const next = waiting.shift()
    if (next) next.start()
    else active--
  }
  return {
    async run(key, task) {
      if (active >= limit) await new Promise<void>((start) => waiting.push({ key, start }))
      else active++
      try {
        return await task()
      } finally {
        release()
      }
    },
    prioritize(keys) {
      const wanted = new Set(keys)
      const first = keys.flatMap((k) => waiting.filter((w) => w.key === k))
      if (first.length === 0) return
      waiting = [...first, ...waiting.filter((w) => !wanted.has(w.key))]
    },
  }
}
