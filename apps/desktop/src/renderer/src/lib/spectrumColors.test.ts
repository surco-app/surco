import { describe, expect, it } from 'vitest'
import { parseColor, rampTableValues, spectrumRampTable } from './spectrumColors'

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

describe('spectrumRampTable', () => {
  const PANEL: [number, number, number] = [26, 27, 38]
  const ACCENT: [number, number, number] = [122, 162, 247]
  const WARN: [number, number, number] = [224, 175, 104]
  const at = (table: string, i: number): number => Number(table.split(' ')[i])

  // Silence and full-loud must still anchor the ends, like the plain ramp, so quiet content
  // reads as the panel floor and the loudest content as the warn peak.
  it('anchors the floor at panel and the top at warn', () => {
    const ramp = spectrumRampTable([PANEL, ACCENT, WARN])
    expect(at(ramp.b, 0)).toBeCloseTo(PANEL[2] / 255, 3)
    const lastG = (s: string): number => Number(s.split(' ').at(-1))
    expect(lastG(ramp.r)).toBeCloseTo(WARN[0] / 255, 3)
  })

  // The whole reason this exists: a faint pixel just above silence must read MUCH closer to
  // the panel than the plain linear ramp would put it, so codec-wall noise sinks into the
  // background instead of glowing accent-blue. Without the low-end fade the same input lands
  // a third of the way to accent already.
  it('pulls a near-floor value toward the panel instead of the accent', () => {
    const ramp = spectrumRampTable([PANEL, ACCENT, WARN])
    // sample ~8% up the range (well inside the floor fraction)
    const i = Math.round(0.08 * (64 - 1))
    const fadedBlue = at(ramp.b, i) * 255
    const linearBlue = PANEL[2] + (ACCENT[2] - PANEL[2]) * (0.08 / 0.5)
    expect(fadedBlue).toBeLessThan(linearBlue)
    expect(fadedBlue).toBeLessThan((PANEL[2] + ACCENT[2]) / 2)
  })
})
