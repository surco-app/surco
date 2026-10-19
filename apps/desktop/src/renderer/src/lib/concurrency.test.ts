import { describe, expect, it } from 'vitest'
import { createPriorityLimit, mapWithConcurrency } from './concurrency'

const delay = <T>(ms: number, value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms))

describe('mapWithConcurrency', () => {
  // addPaths appends results in order and selects items[0]; a pool that returned
  // results in completion order would scramble the track list and selection.
  it('preserves input order even when later items settle first', async () => {
    const result = await mapWithConcurrency([30, 10, 20, 5], 2, (ms, i) => delay(ms, i))
    expect(result).toEqual([0, 1, 2, 3])
  })

  // The whole point: never let a 100-file drop fire 200 reads at once.
  it('never runs more than the limit concurrently', async () => {
    let inFlight = 0
    let peak = 0
    await mapWithConcurrency(
      Array.from({ length: 10 }, (_, i) => i),
      3,
      async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await delay(5, null)
        inFlight--
      },
    )
    expect(peak).toBe(3)
  })

  it('runs every item exactly once', async () => {
    const seen: number[] = []
    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      seen.push(n)
    })
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it('returns an empty array for empty input', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([])
  })
})

describe('createPriorityLimit', () => {
  // One limit shared by separate callers: a playlist opening streams one file per import
  // call, and a cap per call let all of them read at once.
  it('holds the limit across separate callers', async () => {
    const limit = createPriorityLimit(2)
    let inFlight = 0
    let peak = 0
    const task = async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await delay(5, null)
      inFlight--
    }
    await Promise.all([1, 2, 3, 4, 5].map((i) => limit.run(String(i), task)))
    expect(peak).toBe(2)
  })

  it('starts queued work in the order it was asked for', async () => {
    const limit = createPriorityLimit(1)
    const started: number[] = []
    await Promise.all(
      [1, 2, 3].map((n) =>
        limit.run(String(n), async () => {
          started.push(n)
          await delay(1, null)
        }),
      ),
    )
    expect(started).toEqual([1, 2, 3])
  })

  it('frees the slot when a task fails', async () => {
    const limit = createPriorityLimit(1)
    await expect(limit.run('a', async () => Promise.reject(new Error('x')))).rejects.toThrow('x')
    expect(await limit.run('b', async () => 'next')).toBe('next')
  })

  it('starts a waiting task early when its row comes on screen', async () => {
    const limit = createPriorityLimit(1)
    const started: string[] = []
    let releaseFirst: () => void = () => {}
    const first = limit.run('a', () => {
      started.push('a')
      return new Promise<void>((r) => (releaseFirst = r))
    })
    const rest = ['b', 'c', 'd'].map((k) =>
      limit.run(k, async () => {
        started.push(k)
      }),
    )
    limit.prioritize(['d'])
    releaseFirst()
    await Promise.all([first, ...rest])
    expect(started).toEqual(['a', 'd', 'b', 'c'])
  })

  it('keeps every slot when the same key is prioritized twice', async () => {
    const limit = createPriorityLimit(1)
    let releaseFirst: () => void = () => {}
    const first = limit.run('a', () => new Promise<void>((r) => (releaseFirst = r)))
    const started: string[] = []
    const rest = ['b', 'c'].map((k) =>
      limit.run(k, async () => {
        started.push(k)
      }),
    )
    limit.prioritize(['c', 'c'])
    releaseFirst()
    await Promise.all([first, ...rest])
    expect(started).toEqual(['c', 'b'])
    let ranNow = false
    const next = limit.run('d', async () => {
      ranNow = true
    })
    expect(ranNow).toBe(true)
    await next
  })

  it('ignores keys that are running or not queued', async () => {
    const limit = createPriorityLimit(1)
    const started: string[] = []
    const all = ['a', 'b'].map((k) =>
      limit.run(k, async () => {
        started.push(k)
      }),
    )
    limit.prioritize(['a', 'zzz'])
    await Promise.all(all)
    expect(started).toEqual(['a', 'b'])
  })
})
