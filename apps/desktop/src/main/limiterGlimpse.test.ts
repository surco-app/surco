import { describe, expect, it } from 'vitest'
import { glimpseColumns, pickCeilingWindow } from './limiterGlimpse'

const frame = (n: number, t: number, min: number, max: number, count: number): string =>
  [
    `frame:${n}    pts:${n * 16384}   pts_time:${t}`,
    `lavfi.astats.1.Min_level=${min}`,
    `lavfi.astats.1.Max_level=${max}`,
    `lavfi.astats.1.Peak_count=${count}`,
  ].join('\n')

describe('pickCeilingWindow', () => {
  // The glimpse has to show the limiter at work, and a window counting many samples at
  // its own, lower peak is just a sustained quiet note: only windows reaching the copy's
  // ceiling are candidates, and among them the one pinning the most samples there.
  it('picks the window with the most samples at the copy ceiling, not at a lower peak', () => {
    const text = [
      frame(0, 0, 0, 0, 32768),
      frame(1, 0.37, -900, 900, 400),
      frame(2, 0.74, -29420, 29420, 6),
      frame(3, 1.11, -29000, 29420, 19),
      frame(4, 1.48, -29420, 28000, 3),
    ].join('\n')
    expect(pickCeilingWindow(text)).toBe(1.11)
  })

  it('finds nothing in a silent or unreadable copy', () => {
    expect(pickCeilingWindow(frame(0, 0, 0, 0, 32768))).toBeNull()
    expect(pickCeilingWindow('')).toBeNull()
  })
})

describe('glimpseColumns', () => {
  // The better copy is drawn at the worse one's level, so whatever of it rises past the
  // worse copy is what the limiter took away. Scaling must happen before the envelope.
  it('brings the better copy to the worse copy level and lines it up by the lag', () => {
    const worse = Float32Array.from([0, 0.5, -0.5, 0.5, -0.5, 0])
    const better = Float32Array.from([9, 9, 0, 0.25, -0.25, 0.375, -0.25, 0])
    const out = glimpseColumns(worse, better, { lag: 2, gain: 2, from: 1, length: 4, columns: 2 })
    expect(out).toEqual({
      worse: [-0.5, 0.5, -0.5, 0.5],
      better: [-0.5, 0.5, -0.5, 0.75],
    })
  })

  it('gives nothing when the better copy does not cover the window', () => {
    const worse = new Float32Array(10)
    const better = new Float32Array(4)
    expect(
      glimpseColumns(worse, better, { lag: 0, gain: 1, from: 2, length: 6, columns: 3 }),
    ).toBeNull()
  })
})
