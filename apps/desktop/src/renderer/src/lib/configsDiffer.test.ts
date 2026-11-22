import { describe, expect, it } from 'vitest'
import { configsDiffer } from './configsDiffer'

describe('configsDiffer', () => {
  it('is false for copies of the same setting, whatever their key order', () => {
    expect(
      configsDiffer([
        { mode: 'soft', noise: 'off' },
        { noise: 'off', mode: 'soft' },
      ]),
    ).toBe(false)
  })

  it('ignores a key that is present but undefined, as the same setting saved without it', () => {
    expect(configsDiffer([{ mode: 'peak', peakPerChannel: undefined }, { mode: 'peak' }])).toBe(
      false,
    )
  })

  it('is true as soon as one config differs from the rest', () => {
    expect(configsDiffer([{ mode: 'soft' }, { mode: 'soft' }, { mode: 'strong' }])).toBe(true)
  })

  it('is false for a single config or none', () => {
    expect(configsDiffer([{ mode: 'soft' }])).toBe(false)
    expect(configsDiffer([])).toBe(false)
  })
})
