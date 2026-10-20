import { describe, expect, it } from 'vitest'
import { CUE_QUANTIZE, DEFAULT_CUE_QUANTIZE, normalizeCueQuantize } from './cueQuantize'

describe('normalizeCueQuantize', () => {
  it('keeps the bar and the beat, the two basic values rekordbox offers', () => {
    for (const unit of CUE_QUANTIZE) expect(normalizeCueQuantize(unit)).toBe(unit)
  })

  it('falls back to the bar for anything a hand-edited or older file holds, because the whole flow is counted in bars', () => {
    for (const value of [undefined, null, 0, 'half', 'Beat', 1, {}]) {
      expect(normalizeCueQuantize(value)).toBe(DEFAULT_CUE_QUANTIZE)
    }
    expect(DEFAULT_CUE_QUANTIZE).toBe('bar')
  })
})
