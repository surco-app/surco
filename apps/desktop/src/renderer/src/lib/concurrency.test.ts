import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from './concurrency'

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
