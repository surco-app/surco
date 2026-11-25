import { describe, expect, it } from 'vitest'
import { fft } from './fft'

describe('fft', () => {
  it('puts a cosine on exactly its own bin and mirror, so every spectral pass reads a tone where it is', () => {
    const n = 64
    const k = 5
    const re = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * k * i) / n))
    const im = new Float64Array(n)
    fft(re, im)
    for (let bin = 0; bin < n; bin++) {
      const expected = bin === k || bin === n - k ? n / 2 : 0
      expect(re[bin]).toBeCloseTo(expected, 9)
      expect(im[bin]).toBeCloseTo(0, 9)
    }
  })

  it('keeps the forward sign (e^-i), so a caller that reads phase gets the convention it was written for', () => {
    const n = 16
    const re = Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * i) / n))
    const im = new Float64Array(n)
    fft(re, im)
    expect(im[1]).toBeCloseTo(-n / 2, 9)
    expect(im[n - 1]).toBeCloseTo(n / 2, 9)
  })
})
