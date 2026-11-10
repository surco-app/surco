import { describe, expect, it, vi } from 'vitest'
import { sameClockFit, shiftedFit } from './sameClockGrid'

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

describe('shiftedFit', () => {
  it('moves the fine measurements onto the program clock with the rest, or Auto would fit them a few ms off', () => {
    const fit = {
      bpm: 128,
      firstMs: 10,
      phases: [{ ms: 5000, firstMs: 10 }],
      fine: [{ ms: 2000, firstMs: 11 }],
    }
    expect(shiftedFit(fit, 7)).toEqual({
      bpm: 128,
      firstMs: 17,
      phases: [{ ms: 5007, firstMs: 17 }],
      fine: [{ ms: 2007, firstMs: 18 }],
    })
  })
})
