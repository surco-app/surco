import { describe, expect, it, vi } from 'vitest'
import { BODY_ENTRIES, detailSourceOf, paintWave, waveColumns } from './cueDetail'

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

describe('waveColumns on the fine wave Surco measures', () => {
  const fine = (levels: Uint8Array, startMs = 0) => ({ fine: { levels, perSecond: 1000, startMs } })

  // rekordbox's wave holds 150 levels a second, so a one-bar zoom showed steps tens of pixels
  // wide. The fine wave puts a click in its own millisecond, on the program's clock.
  it('puts each level at its millisecond, moved to the program clock by where the wave starts', () => {
    const levels = new Uint8Array(1000)
    levels[37] = 255
    const columns = waveColumns(fine(levels, 51), 80, 100, 20)
    expect(columns[8]?.peak).toBe(1)
    expect(columns[7]?.peak).toBe(0)
    expect(columns[9]?.peak).toBe(0)
  })

  it('keeps the body as loudness over the same span as on rekordbox wave, not over one millisecond', () => {
    const lone = new Uint8Array(1000)
    lone[500] = 255
    const [click] = waveColumns(fine(lone), 500, 501, 1)
    expect(click?.peak).toBe(1)
    expect(click?.body).toBeLessThan(0.2)
    const held = new Uint8Array(1000).fill(128)
    const [solid] = waveColumns(fine(held), 500, 501, 1)
    expect(solid?.body).toBeCloseTo(128 / 255)
  })

  it('leaves blank the time before the wave starts', () => {
    expect(waveColumns(fine(new Uint8Array(1000).fill(200), 51), 0, 40, 2)).toEqual([null, null])
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

describe('detailSourceOf', () => {
  const words = new Uint16Array(150).fill(word(8))
  const wave = [{ h: 0.5, rgb: null }]
  const fine = { levels: new Uint8Array([10]), perSecond: 1000, startMs: 0 }

  it('draws the fine wave once it is in', () => {
    expect(detailSourceOf({ fine, words, wave, durationMs: 1000 })).toEqual({ fine })
  })

  it('draws rekordbox wave while the fine one loads, which already matches its peaks', () => {
    expect(detailSourceOf({ fine: undefined, words, wave, durationMs: 1000 })).toEqual({ words })
  })

  it('draws nothing while the fine wave loads and rekordbox has none, never the overview stretched to fill the zoom', () => {
    expect(detailSourceOf({ fine: undefined, words: null, wave, durationMs: 1000 })).toBeNull()
  })

  it('falls back to the overview only when no finer wave will come', () => {
    expect(detailSourceOf({ fine: null, words: null, wave, durationMs: 1000 })).toEqual({
      wave,
      durationMs: 1000,
    })
  })

  it('keeps rekordbox wave where the fine wave is not asked for, as in the folded section', () => {
    expect(detailSourceOf({ fine: null, words, wave, durationMs: 1000 })).toEqual({ words })
  })
})
