import { describe, expect, it } from 'vitest'
import { speedFrame } from './speed'

describe('speed figures', () => {
  it('ends on the measured figures, because the page may only claim what was measured', () => {
    expect(speedFrame(1, 'es')).toEqual(['44', '25.000', '5,3'])
  })
  it('starts from zero with the final number of decimals, so the figure keeps its shape while it counts', () => {
    expect(speedFrame(0, 'es')).toEqual(['0', '0', '0,0'])
  })
  it('writes each figure with the separators of the visitor language', () => {
    expect(speedFrame(1, 'en')).toEqual(['44', '25,000', '5.3'])
    expect(speedFrame(1, 'de')).toEqual(['44', '25.000', '5,3'])
  })
  it('never overshoots or goes negative when a frame arrives outside the run', () => {
    expect(speedFrame(1.4, 'es')).toEqual(speedFrame(1, 'es'))
    expect(speedFrame(-0.2, 'es')).toEqual(speedFrame(0, 'es'))
  })
  it('never shows more than the final figure on the way up', () => {
    for (const t of [0.1, 0.5, 0.9, 0.99]) {
      const [open] = speedFrame(t, 'en')
      expect(Number(open)).toBeLessThanOrEqual(44)
    }
  })
  it('is already most of the way after half the run, so the count settles instead of racing to the end', () => {
    expect(Number(speedFrame(0.5, 'en')[0])).toBeGreaterThan(38)
  })
})
