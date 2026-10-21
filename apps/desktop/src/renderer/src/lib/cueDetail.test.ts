import { describe, expect, it, vi } from 'vitest'
import { BODY_ENTRIES, paintWave, waveColumns } from './cueDetail'

const word = (h: number) => (7 << 13) | (h << 2)

describe('waveColumns', () => {
  const words = new Uint16Array(150)
  words[10] = word(31)
  words[60] = word(20)
  words[120] = word(5)

  it('gives one column per requested pixel, the tallest entry of each as its peak, at 150 entries a second', () => {
    expect(waveColumns({ words }, 0, 1000, 3).map((c) => c?.peak)).toEqual([1, 20 / 31, 5 / 31])
  })

  it('keeps a lone transient tall in the peak but low in the body, so the body reads as loudness like rekordbox and not as clicks', () => {
    const [column] = waveColumns({ words }, 60, 80, 1)
    expect(column?.peak).toBe(1)
    expect(column?.body).toBeCloseTo(Math.sqrt(1 / BODY_ENTRIES))
  })

  it('fills the body up to the peak where the level holds, so a sustained part reads solid', () => {
    const held = new Uint16Array(150).fill(word(20))
    const [column] = waveColumns({ words: held }, 400, 500, 1)
    expect(column?.peak).toBe(20 / 31)
    expect(column?.body).toBeCloseTo(20 / 31)
  })

  it('gives every device pixel its own column when zoomed past one entry per pixel, instead of stretching one entry over many', () => {
    const ramp = new Uint16Array(150).map((_, i) => word(i % 32))
    const columns = waveColumns({ words: ramp }, 0, 100, 30)
    expect(columns).toHaveLength(30)
    expect(new Set(columns.map((c) => c?.peak)).size).toBeGreaterThan(10)
  })

  it('leaves blank the part of the window before the start or after the end of the track', () => {
    expect(waveColumns({ words }, -1000, 0, 2)).toEqual([null, null])
    expect(waveColumns({ words }, 1000, 2000, 2)).toEqual([null, null])
  })

  it('reads the overview when rekordbox has no PWV5 for the track', () => {
    const wave = [
      { h: 0.1, rgb: null },
      { h: 0.2, rgb: null },
      { h: 0.3, rgb: null },
      { h: 0.4, rgb: null },
    ]
    expect(waveColumns({ wave, durationMs: 4000 }, 1000, 3000, 2).map((c) => c?.peak)).toEqual([
      0.2, 0.3,
    ])
  })
})

describe('paintWave', () => {
  it('paints each column one device pixel wide, the faint peak first and the accent body over it, centred', () => {
    const calls: [string, number, number, number, number][] = []
    let style = ''
    const g = {
      set fillStyle(v: string) {
        style = v
      },
      globalAlpha: 1,
      fillRect: vi.fn((x: number, y: number, w: number, h: number) =>
        calls.push([style, x, y, w, h]),
      ),
    }
    paintWave(g as never, [{ peak: 1, body: 0.5 }, null], 100, { peak: 'ink', body: 'accent' })
    expect(calls).toEqual([
      ['ink', 0, 0, 1, 100],
      ['accent', 0, 25, 1, 50],
    ])
  })
})
