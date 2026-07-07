import { describe, expect, it } from 'vitest'
import { applyDuotone, duotoneLut, reportVerdictColor } from './qualityReport'

describe('duotoneLut', () => {
  // feComponentTransfer type="table" semantics: the table holds [0,1] stops evenly spread
  // over the gray range, interpolated linearly between neighbours. The LUT must reproduce
  // that mapping per 8-bit level so the exported PNG matches the on-screen SVG recolor.
  it('expands a two-stop identity table to a linear 256-entry lut', () => {
    const lut = duotoneLut({ r: '0 1', g: '0 1', b: '0 1' })
    expect(lut.r[0]).toBe(0)
    expect(lut.r[255]).toBe(255)
    expect(lut.g[128]).toBe(128)
  })

  it('interpolates between inner table stops', () => {
    // Three stops 0 → 1 → 0: mid-gray hits the peak, the ends sit at 0.
    const lut = duotoneLut({ r: '0 1 0', g: '0 1 0', b: '0 1 0' })
    expect(lut.r[0]).toBe(0)
    expect(lut.r[255]).toBe(0)
    expect(lut.r[128]).toBeGreaterThan(250)
  })
})

describe('applyDuotone', () => {
  // The spectrogram arrives as grayscale; recoloring maps each pixel's gray level through
  // the per-channel LUTs, leaving alpha untouched — the same transform the SVG filter does.
  it('maps gray levels through the lut channels and keeps alpha', () => {
    const lut = {
      r: new Uint8ClampedArray(256).fill(10),
      g: new Uint8ClampedArray(256).fill(20),
      b: new Uint8ClampedArray(256).fill(30),
    }
    lut.r[255] = 200
    const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 128])
    applyDuotone(data, lut)
    expect([...data]).toEqual([10, 20, 30, 255, 200, 20, 30, 128])
  })
})

describe('reportVerdictColor', () => {
  // The report uses a fixed dark palette (not the live theme) so a shared PNG looks the
  // same everywhere; the verdict tone maps to the same token colors the badge uses.
  it('maps each verdict tone to its fixed badge color', () => {
    expect(reportVerdictColor('good')).toBe('#9ece6a')
    expect(reportVerdictColor('warn')).toBe('#e0af68')
    expect(reportVerdictColor('bad')).toBe('#f7768e')
    expect(reportVerdictColor('processed')).toBe('#f7768e')
  })
})
