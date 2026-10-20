import { describe, expect, it } from 'vitest'
import { decodeWaveWord, visibleColumns } from './cueDetail'

const word = (r: number, g: number, b: number, h: number) =>
  (r << 13) | (g << 10) | (b << 7) | (h << 2)

describe('decodeWaveWord', () => {
  it('reads height and colour the way the overview reads PWV5', () => {
    expect(decodeWaveWord(word(7, 0, 0, 31))).toEqual({ h: 1, rgb: [255, 0, 0] })
    expect(decodeWaveWord(word(0, 7, 0, 0))).toEqual({ h: 0, rgb: [0, 255, 0] })
  })
})

describe('visibleColumns', () => {
  const words = new Uint16Array(150)
  words[10] = word(7, 0, 0, 31)
  words[60] = word(0, 7, 0, 20)
  words[120] = word(0, 0, 7, 5)

  it('gives one column per pixel of the window, the tallest entry of each, at 150 entries a second', () => {
    expect(visibleColumns({ words }, 0, 1000, 3)).toEqual([
      { h: 1, rgb: [255, 0, 0] },
      { h: 20 / 31, rgb: [0, 255, 0] },
      { h: 5 / 31, rgb: [0, 0, 255] },
    ])
  })

  it('leaves blank the part of the window before the start or after the end of the track', () => {
    expect(visibleColumns({ words }, -1000, 0, 2)).toEqual([null, null])
    expect(visibleColumns({ words }, 1000, 2000, 2)).toEqual([null, null])
  })

  it('stretches the overview when rekordbox has no PWV5 for the track', () => {
    const wave = [
      { h: 0.1, rgb: null },
      { h: 0.2, rgb: null },
      { h: 0.3, rgb: null },
      { h: 0.4, rgb: null },
    ]
    expect(visibleColumns({ wave, durationMs: 4000 }, 1000, 3000, 2)).toEqual([wave[1], wave[2]])
  })
})
