import { describe, expect, it, vi } from 'vitest'
import { sameClockFit } from './sameClockGrid'

describe('sameClockFit', () => {
  it('measures only the files Traktor and Engine play on the clock Surco draws, uncompressed ones', async () => {
    const beatGrid = vi.fn(async () => ({ bpm: 128, firstMs: 10 }))
    expect(await sameClockFit('/m/a.mp3', beatGrid)).toBeNull()
    expect(await sameClockFit('/m/a.m4a', beatGrid)).toBeNull()
    expect(beatGrid).not.toHaveBeenCalled()
    expect(await sameClockFit('/m/a.FLAC', beatGrid)).toMatchObject({ bpm: 128, firstMs: 12 })
    expect(await sameClockFit('/m/a.aif', beatGrid)).toMatchObject({ firstMs: 12 })
  })
})
