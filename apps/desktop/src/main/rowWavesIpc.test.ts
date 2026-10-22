import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, nativeImage: {} }))

import { anlzFile, pqtzSection, pwavSection } from './anlzFixture'
import { barsOf, ROW_WAVE_BARS, type RowWaveSources, rowWaves } from './rowWavesIpc'

const share = '/rb/share'
const dat = `${share}/PIONEER/USBANLZ/p/q/ANLZ0000.DAT`

function sources(over: Partial<RowWaveSources> = {}): RowWaveSources {
  return {
    share,
    readDat: vi.fn(async () => anlzFile(pwavSection(Array(400).fill(31)))),
    peekWave: vi.fn(async () => null),
    ...over,
  }
}

describe('rowWaves', () => {
  it('draws rekordbox own preview for a track it has analysed', async () => {
    const found = await rowWaves([{ path: '/m/a.wav', analysisPath: dat }], sources())
    expect(found[dat]).toHaveLength(ROW_WAVE_BARS)
    expect(found[dat].every((v) => v === 1)).toBe(true)
  })

  it('never reads an analysis file outside the share folder', async () => {
    const s = sources({
      peekWave: vi.fn(async () => ({ peaks: [0.5, 0.5], rms: [0.2, 0.2], durationSec: 1 })),
    })
    const outside = '/etc/passwd'
    const found = await rowWaves([{ path: '/m/a.wav', analysisPath: outside }], s)
    expect(s.readDat).not.toHaveBeenCalled()
    expect(found[outside]).toHaveLength(ROW_WAVE_BARS)
  })

  it('uses the wave Surco already measured for a track rekordbox does not know', async () => {
    const s = sources({
      peekWave: vi.fn(async () => ({
        peaks: [0.1, 0.9, 0.2, 0.4],
        rms: [0.05, 0.3, 0.1, 0.2],
        durationSec: 1,
      })),
    })
    const found = await rowWaves([{ path: '/m/b.wav' }], s)
    expect(found['/m/b.wav']).toHaveLength(ROW_WAVE_BARS)
    expect(Math.max(...found['/m/b.wav'])).toBe(1)
  })

  it('falls back to Surco when the analysis has no preview section', async () => {
    const s = sources({
      readDat: vi.fn(async () => anlzFile(pqtzSection([0, 500]))),
      peekWave: vi.fn(async () => ({ peaks: [0.3], rms: [0.1], durationSec: 1 })),
    })
    const found = await rowWaves([{ path: '/m/a.wav', analysisPath: dat }], s)
    expect(found[dat]).toHaveLength(ROW_WAVE_BARS)
  })

  it('keeps the rest of the batch when one analysis file is cut short, and draws Surco wave for that row', async () => {
    const good = `${share}/PIONEER/USBANLZ/g/h/ANLZ0000.DAT`
    const whole = anlzFile(pwavSection(Array(400).fill(31)))
    const cut = Buffer.from(whole.subarray(0, 40))
    cut.writeUInt32BE(12, 36)
    const s = sources({
      readDat: vi.fn(async (file: string) => (file === dat ? cut : whole)),
      peekWave: vi.fn(async () => ({ peaks: [0.3], rms: [0.1], durationSec: 1 })),
    })
    const found = await rowWaves(
      [
        { path: '/m/a.wav', analysisPath: dat },
        { path: '/m/g.wav', analysisPath: good },
      ],
      s,
    )
    expect(found[dat]).toHaveLength(ROW_WAVE_BARS)
    expect(found[good].every((v) => v === 1)).toBe(true)
  })

  it('answers nothing for a track with no wave anywhere, so the row stays empty', async () => {
    const found = await rowWaves([{ path: '/m/c.wav' }], sources())
    expect(found).toEqual({})
  })
})

describe('barsOf', () => {
  it('draws the body the player draws, not the peaks a loud master pins at full scale', () => {
    const peaks = [0.98, 0.99, 1, 0.97]
    const rms = [0.1, 0.1, 0.4, 0.4]
    const bars = barsOf({ peaks, rms }, 2) ?? []
    expect(bars[1]).toBe(1)
    expect(bars[0]).toBeLessThan(0.5)
  })

  it('takes the quadratic mean of each slice, which is what an RMS over the merged span is', () => {
    expect(barsOf({ peaks: [1, 1, 1, 1], rms: [0.3, 0.4, 0.5, 0.5] }, 2)).toEqual([0.71, 1])
  })

  it('keeps a silent track flat instead of dividing by zero', () => {
    expect(barsOf({ peaks: [0, 0], rms: [0, 0] }, 2)).toEqual([0, 0])
  })

  it('gives nothing for an empty wave', () => {
    expect(barsOf({ peaks: [], rms: [] }, 2)).toBeNull()
  })
})
