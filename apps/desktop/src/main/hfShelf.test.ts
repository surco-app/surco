import { describe, expect, it } from 'vitest'
import { bandEnergiesDb, BAND_START_HZ, BAND_WIDTH_HZ, detectFlatShelf } from './hfShelf'

// Real whole-track (4 min) band energies measured with the same Blackman-Harris
// Welch FFT the analyzer runs, in dBFS per 1 kHz band from 8 kHz to 21 kHz
// (14 values). The reprocessed pair carry a synthetic flat shelf grafted onto a
// rolled-off source; the genuine ones taper or stay bright. Captured from the
// library so the thresholds are pinned to measured spectra, not invented numbers.
const NYQUIST = 22050

// Klis Klas Corp - This: real content dies ~16 kHz, then a dead-flat shelf
// (53.x dB across 17-22 kHz) holds to Nyquist — added highs.
const KLIS = [68.1, 67.3, 67.0, 65.9, 64.2, 62.2, 60.2, 56.8, 54.2, 53.4, 53.1, 53.1, 53.0, 53.0]
// Alex & Giro - Konichiwa: same fingerprint, a touch deeper shelf.
const KONICHIWA = [
  70.3, 68.7, 66.6, 64.1, 61.9, 59.8, 58.0, 56.3, 53.5, 51.9, 51.2, 51.1, 51.1, 51.3,
]
// DJ DBC - Check Check This Out: genuine taper that keeps falling to the top.
const CHECK_CHECK = [
  75.2, 73.9, 72.7, 71.9, 70.3, 68.3, 65.6, 62.0, 61.6, 60.5, 59.5, 59.6, 59.0, 58.6,
]
// Lazzard - Save Me: the nearest genuine file, still clearly declining.
const LAZZARD = [70.8, 68.6, 68.4, 66.7, 65.8, 64.7, 64.1, 61.4, 59.7, 58.8, 58.1, 57.2, 56.7, 56.3]
// DJ Misjah - The Professional: genuine dark master, deep continuous taper.
const MISJAH = [75.6, 73.3, 73.1, 69.9, 67.4, 63.3, 59.7, 54.9, 50.2, 47.6, 46.6, 45.8, 45.3, 45.2]
// Yulbox - The Week Is Over: genuinely bright master, HF rises back near plateau.
const YULBOX = [79.6, 77.8, 77.4, 75.7, 74.5, 71.7, 69.7, 65.7, 66.4, 70.9, 73.0, 72.5, 74.5, 72.3]

describe('detectFlatShelf', () => {
  it('flags a dead-flat synthetic shelf held to Nyquist and points the cutoff at the real ceiling', () => {
    // Klis' real content ends ~16 kHz: the cutoff names that ceiling, not the
    // shelf reaching Nyquist, so the dashed line and "reprocessed" verdict agree.
    expect(detectFlatShelf(KLIS, BAND_START_HZ, BAND_WIDTH_HZ, NYQUIST)).toBe(16000)
  })

  it('flags a deeper synthetic shelf', () => {
    expect(detectFlatShelf(KONICHIWA, BAND_START_HZ, BAND_WIDTH_HZ, NYQUIST)).toBe(17000)
  })

  it('leaves a genuine taper that keeps falling to the top alone', () => {
    expect(detectFlatShelf(CHECK_CHECK, BAND_START_HZ, BAND_WIDTH_HZ, NYQUIST)).toBeNull()
  })

  it('leaves the nearest-genuine gently-rolled-off master alone', () => {
    expect(detectFlatShelf(LAZZARD, BAND_START_HZ, BAND_WIDTH_HZ, NYQUIST)).toBeNull()
  })

  it('leaves a deep dark taper alone — a deep flat floor is a roll-off, not added highs', () => {
    expect(detectFlatShelf(MISJAH, BAND_START_HZ, BAND_WIDTH_HZ, NYQUIST)).toBeNull()
  })

  it('leaves a genuinely bright master alone — strong real highs near the plateau', () => {
    expect(detectFlatShelf(YULBOX, BAND_START_HZ, BAND_WIDTH_HZ, NYQUIST)).toBeNull()
  })

  it('does not flag a full-band flat spectrum (white-noise-like): flat but not detached', () => {
    const flat = new Array(14).fill(-30)
    expect(detectFlatShelf(flat, BAND_START_HZ, BAND_WIDTH_HZ, NYQUIST)).toBeNull()
  })

  it('does not flag a deep flat noise floor above a hard cut (handled as a codec knee elsewhere)', () => {
    // Plateau at 0, then a flat floor 40 dB down: too deep to be added musical
    // highs — flagging it as "reprocessed" would mislabel an ordinary lossy cut.
    const cut = [0, -1, -2, -10, -20, -35, -42, -42, -42, -42, -42, -42, -42, -42]
    expect(detectFlatShelf(cut, BAND_START_HZ, BAND_WIDTH_HZ, NYQUIST)).toBeNull()
  })

  it('does not flag silence (every band equal at the floor, no detachment)', () => {
    const silence = new Array(14).fill(-120)
    expect(detectFlatShelf(silence, BAND_START_HZ, BAND_WIDTH_HZ, NYQUIST)).toBeNull()
  })
})

describe('bandEnergiesDb', () => {
  const SR = 44100
  function tone(freqHz: number, seconds: number): Float32Array {
    const n = Math.floor(SR * seconds)
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * freqHz * i) / SR)
    return out
  }

  it('puts a high tone in its own 1 kHz band and starts at 8 kHz', () => {
    const bands = bandEnergiesDb(tone(18500, 6), SR)
    expect(bands.length).toBe(14) // 8..21 kHz starts
    const peak = bands.indexOf(Math.max(...bands))
    // 18.5 kHz falls in the [18000, 19000) band → index 10 from an 8 kHz start.
    expect(BAND_START_HZ + peak * BAND_WIDTH_HZ).toBe(18000)
  })

  it('locates a lower tone in the correct band', () => {
    const bands = bandEnergiesDb(tone(9500, 6), SR)
    const peak = bands.indexOf(Math.max(...bands))
    expect(BAND_START_HZ + peak * BAND_WIDTH_HZ).toBe(9000)
  })
})
