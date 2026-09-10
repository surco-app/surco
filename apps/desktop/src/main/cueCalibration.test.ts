import { describe, expect, it } from 'vitest'
import { automaticCueOffsetMs } from './cueCalibration'

describe('automatic Traktor codec cue calibration', () => {
  it.each(['.flac', '.aif', '.aiff', '.wav'])('%s → MP3 is +51 ms', (input) => {
    expect(automaticCueOffsetMs(input, '.mp3')).toBe(51)
  })
  it.each(['.flac', '.aif', '.aiff'])('MP3 → %s is −51 ms', (output) => {
    expect(automaticCueOffsetMs('.mp3', output)).toBe(-51)
  })
  it('does not calibrate MP3 → WAV, MP3 → ALAC or MP3 → MP3', () => {
    expect(automaticCueOffsetMs('.mp3', '.wav')).toBe(0)
    expect(automaticCueOffsetMs('.mp3', '.m4a')).toBe(0)
    expect(automaticCueOffsetMs('.mp3', '.mp3')).toBe(0)
  })
  it('normalizes case and extensions without a leading dot', () => {
    expect(automaticCueOffsetMs('MP3', 'AIFF')).toBe(-51)
    expect(automaticCueOffsetMs('FLAC', 'MP3')).toBe(51)
  })
})
