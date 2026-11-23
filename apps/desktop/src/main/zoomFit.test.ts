import { describe, expect, it } from 'vitest'
import { zoomFit } from './zoomFit'

const MIN = { width: 1080, height: 620 }
const factor = (level: number): number => 1.2 ** level

describe('zoomFit', () => {
  it('keeps the window as it is at the normal size', () => {
    expect(zoomFit(0, { width: 1440, height: 875 }, MIN)).toEqual({
      level: 0,
      minimum: { width: 1080, height: 620 },
    })
  })

  it('raises the smallest window with the zoom, so the whole app still fits on screen', () => {
    const fit = zoomFit(1, { width: 1920, height: 1055 }, MIN)
    expect(fit.level).toBe(1)
    expect(fit.minimum.width).toBe(Math.ceil(1080 * factor(1)))
    expect(fit.minimum.height).toBe(Math.ceil(620 * factor(1)))
  })

  it('steps back to the largest zoom the screen can hold, since a cut-off app hides the editor and the convert button', () => {
    const fit = zoomFit(4, { width: 1470, height: 919 }, MIN)
    expect(fit.level).toBe(1.5)
    expect(fit.minimum.width).toBeLessThanOrEqual(1470)
    expect(fit.minimum.height).toBeLessThanOrEqual(919)
    expect(1080 * factor(fit.level + 0.5)).toBeGreaterThan(1470)
  })

  it('lets the user zoom out below the normal size, which always fits', () => {
    expect(zoomFit(-1, { width: 1080, height: 620 }, MIN).level).toBe(-1)
  })

  it('never goes below the normal size on a screen too small even for it', () => {
    expect(zoomFit(2, { width: 1000, height: 600 }, MIN).level).toBe(0)
  })
})
