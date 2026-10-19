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
      peekWave: vi.fn(async () => ({ peaks: [0.5, 0.5], rms: [], durationSec: 1 })),
    })
    const outside = '/etc/passwd'
    const found = await rowWaves([{ path: '/m/a.wav', analysisPath: outside }], s)
    expect(s.readDat).not.toHaveBeenCalled()
    expect(found[outside]).toHaveLength(ROW_WAVE_BARS)
  })

  it('uses the wave Surco already measured for a track rekordbox does not know', async () => {
    const s = sources({
      peekWave: vi.fn(async () => ({ peaks: [0.1, 0.9, 0.2, 0.4], rms: [], durationSec: 1 })),
    })
    const found = await rowWaves([{ path: '/m/b.wav' }], s)
    expect(found['/m/b.wav']).toHaveLength(ROW_WAVE_BARS)
    expect(Math.max(...found['/m/b.wav'])).toBe(0.9)
  })

  it('falls back to Surco when the analysis has no preview section', async () => {
    const s = sources({
      readDat: vi.fn(async () => anlzFile(pqtzSection([0, 500]))),
      peekWave: vi.fn(async () => ({ peaks: [0.3], rms: [], durationSec: 1 })),
    })
    const found = await rowWaves([{ path: '/m/a.wav', analysisPath: dat }], s)
    expect(Math.max(...found[dat])).toBe(0.3)
  })

  it('keeps the rest of the batch when one analysis file is cut short, and draws Surco wave for that row', async () => {
    const good = `${share}/PIONEER/USBANLZ/g/h/ANLZ0000.DAT`
    const whole = anlzFile(pwavSection(Array(400).fill(31)))
    const cut = Buffer.from(whole.subarray(0, 40))
    cut.writeUInt32BE(12, 36)
    const s = sources({
      readDat: vi.fn(async (file: string) => (file === dat ? cut : whole)),
      peekWave: vi.fn(async () => ({ peaks: [0.3], rms: [], durationSec: 1 })),
    })
    const found = await rowWaves(
      [
        { path: '/m/a.wav', analysisPath: dat },
        { path: '/m/g.wav', analysisPath: good },
      ],
      s,
    )
    expect(Math.max(...found[dat])).toBe(0.3)
    expect(found[good].every((v) => v === 1)).toBe(true)
  })

  it('answers nothing for a track with no wave anywhere, so the row stays empty', async () => {
    const found = await rowWaves([{ path: '/m/c.wav' }], sources())
    expect(found).toEqual({})
  })
})

describe('barsOf', () => {
  it('keeps the loudest peak of each slice, so a short hit survives at row size', () => {
    expect(barsOf([0.1, 0.9, 0.2, 0.4], 2)).toEqual([0.9, 0.4])
  })

  it('gives nothing for an empty wave', () => {
    expect(barsOf([], 2)).toBeNull()
  })
})
