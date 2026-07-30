import { describe, expect, it } from 'vitest'
import { barsPath } from './envelope'

// Reads every coordinate the path visits. An earlier test asserted the sampled
// points rather than the emitted path, and passed while the drawn waveform crossed
// itself in an X — so these check the geometry that actually ships.
function coords(d: string) {
  return (d.match(/-?\d+(\.\d+)?,-?\d+(\.\d+)?/g) ?? []).map((pair) => {
    const [x, y] = pair.split(',').map(Number)
    return { x, y }
  })
}

describe('barsPath', () => {
  it('centres every bar on the axis', () => {
    // Each bar starts at MID - h and is 2h tall, so its midpoint is the axis.
    const d = barsPath([1, 0.5, 0.25], 40, 0)
    const tops = coords(d).map((p) => p.y)
    const heights = [40, 20, 10]
    tops.forEach((top, i) => {
      expect(top).toBeCloseTo(50 - heights[i], 1)
    })
  })

  it('spans the full width', () => {
    const d = barsPath([0.5, 0.5, 0.5, 0.5], 44, 0)
    const xs = coords(d).map((p) => p.x)
    expect(Math.min(...xs)).toBeCloseTo(0, 1)
    expect(Math.max(...xs)).toBeCloseTo(750, 1)
  })

  it('stays inside the viewBox at full amplitude', () => {
    for (const p of coords(barsPath([1, 1, 1], 44))) {
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(100)
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(1000)
    }
  })

  it('gives a silent column a visible sliver rather than nothing', () => {
    // The tail fades to exact zero; a zero-height rect would leave a gap in the strip.
    const d = barsPath([0], 44)
    expect(coords(d)[0].y).toBeLessThan(50)
  })

  it('emits one subpath per bar', () => {
    expect(barsPath([0.2, 0.4, 0.6]).match(/M/g)).toHaveLength(3)
  })

  it('handles an empty series', () => {
    expect(barsPath([])).toBe('')
  })
})
