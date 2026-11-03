import { describe, expect, it, vi } from 'vitest'
import { sameClockFit } from './sameClockGrid'

describe('sameClockFit', () => {
  it('measures only files whose clock in the program is known, moved onto that clock', async () => {
    const beatGrid = vi.fn(async () => ({ bpm: 128, firstMs: 10 }))
    expect(await sameClockFit('/m/a.mp3', beatGrid, 'high', null)).toBeNull()
    expect(beatGrid).not.toHaveBeenCalled()
    expect(await sameClockFit('/m/a.flac', beatGrid, 'high', 0)).toMatchObject({
      bpm: 128,
      firstMs: 12,
    })
    expect(await sameClockFit('/m/a.mp3', beatGrid, 'high', 27)).toMatchObject({ firstMs: 39 })
  })
})
