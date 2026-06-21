import { describe, expect, it } from 'vitest'
import { parseColor, rampTableValues } from './spectrumColors'

describe('parseColor', () => {
  it('reads a 6-digit hex token into 8-bit channels', () => {
    expect(parseColor('#7aa2f7')).toEqual([122, 162, 247])
  })

  // Line/border tokens in the theme are rgba(), not hex, so the duotone has to accept both
  // or the floor color silently falls back to black and the whole ramp goes dark.
  it('reads an rgba() token, ignoring the alpha', () => {
    expect(parseColor('rgba(20, 22, 38, 0.12)')).toEqual([20, 22, 38])
  })

  it('falls back to black when the token is missing', () => {
    expect(parseColor('')).toEqual([0, 0, 0])
  })
})

describe('rampTableValues', () => {
  // The whole point of the ramp: a silent (black) pixel must land on the first stop and a
  // loud (white) pixel on the last stop, so quiet content reads as the floor color and loud
  // content as the peak color. The middle stop bends the ramp through the accent hue.
  it('maps silence to the first stop and loud content to the last', () => {
    const ramp = rampTableValues([
      [26, 27, 38],
      [122, 162, 247],
      [224, 175, 104],
    ])
    const first = (table: string): string => table.split(' ')[0]
    const last = (table: string): string => table.split(' ').at(-1) as string
    expect(first(ramp.r)).toBe((26 / 255).toFixed(4))
    expect(first(ramp.g)).toBe((27 / 255).toFixed(4))
    expect(first(ramp.b)).toBe((38 / 255).toFixed(4))
    expect(last(ramp.r)).toBe((224 / 255).toFixed(4))
    expect(last(ramp.g)).toBe((175 / 255).toFixed(4))
    expect(last(ramp.b)).toBe((104 / 255).toFixed(4))
  })

  it('emits one table entry per stop on each channel', () => {
    const ramp = rampTableValues([
      [0, 0, 0],
      [10, 20, 30],
      [40, 50, 60],
    ])
    expect(ramp.r.split(' ')).toHaveLength(3)
    expect(ramp.g.split(' ')).toHaveLength(3)
    expect(ramp.b.split(' ')).toHaveLength(3)
  })
})
