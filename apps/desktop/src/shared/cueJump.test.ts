import { describe, expect, it } from 'vitest'
import { CUE_JUMP_BARS, DEFAULT_CUE_JUMP_BARS, normalizeCueJumpBars } from './cueJump'

describe('normalizeCueJumpBars', () => {
  it('keeps the four jumps the editor offers', () => {
    for (const bars of CUE_JUMP_BARS) expect(normalizeCueJumpBars(bars)).toBe(bars)
  })

  it('falls back to 16 for anything a hand-edited or older file holds, so the arrows always move', () => {
    for (const value of [undefined, null, 0, 12, 128, '32', -16]) {
      expect(normalizeCueJumpBars(value)).toBe(DEFAULT_CUE_JUMP_BARS)
    }
    expect(DEFAULT_CUE_JUMP_BARS).toBe(16)
  })
})
