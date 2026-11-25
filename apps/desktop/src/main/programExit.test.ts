import { describe, expect, it, vi } from 'vitest'
import { waitForExit } from './programExit'

describe('waitForExit', () => {
  it('reports the program gone as soon as it stops running, so a write can follow at once', async () => {
    const isRunning = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false)
    const wait = vi.fn(async (_ms: number) => {})
    expect(await waitForExit(isRunning, { wait })).toBe(true)
    expect(isRunning).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledTimes(1)
  })

  it('gives up after thirty checks half a second apart, so a refused quit never writes under a live library', async () => {
    const isRunning = vi.fn(async () => true)
    const wait = vi.fn(async (_ms: number) => {})
    expect(await waitForExit(isRunning, { wait })).toBe(false)
    expect(isRunning).toHaveBeenCalledTimes(30)
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual(Array(30).fill(500))
  })

  it('honours a shorter poll when the caller asks for one', async () => {
    const isRunning = vi.fn(async () => true)
    const wait = vi.fn(async (_ms: number) => {})
    expect(await waitForExit(isRunning, { attempts: 2, waitMs: 0, wait })).toBe(false)
    expect(wait.mock.calls).toEqual([[0], [0]])
  })
})
