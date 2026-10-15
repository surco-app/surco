import { describe, expect, it } from 'vitest'
import { type CopyFacts, compareCopies, isSameAudio } from './bestCopy'

const sameMaster = { correlation: 0.9956, residualDb: -20.5, gainDb: -2.2 }
const otherMaster = { correlation: 0.8618, residualDb: -5.9, gainDb: 0.4 }

const netzwerkWav: CopyFacts = {
  ext: 'wav',
  cutoffHz: 22050,
  hasKnee: false,
  fingerprint: 'w',
  peakCount: 1978,
  crestDb: 10.7,
  integratedLufs: -10,
}
const netzwerkAif: CopyFacts = {
  ext: 'aif',
  cutoffHz: 22050,
  hasKnee: false,
  fingerprint: 'a',
  peakCount: 2,
  crestDb: 13.2,
  integratedLufs: -12.2,
}

describe('compareCopies', () => {
  it('reads two containers of the same samples as the same audio', () => {
    expect(
      compareCopies({ ...netzwerkWav, fingerprint: 'x' }, { ...netzwerkAif, fingerprint: 'x' }),
    ).toEqual({ winner: 'same' })
  })

  // Aquagen: the download sat 6 samples late, so its MD5 differed from an identical copy.
  it('reads a copy shifted by a few samples as the same audio', () => {
    expect(
      compareCopies(
        netzwerkAif,
        { ...netzwerkAif, fingerprint: 'z' },
        { correlation: 1, residualDb: Number.NEGATIVE_INFINITY, gainDb: 0 },
      ),
    ).toEqual({ winner: 'same' })
  })

  // Measured 15/10: the Apple Music WAV was the AIF pushed through a limiter.
  it('prefers the copy a limiter did not flatten (Netzwerk)', () => {
    expect(compareCopies(netzwerkWav, netzwerkAif, sameMaster)).toEqual({
      winner: 'b',
      reason: 'peakCount',
    })
  })

  // Wiki Wiki: two masters of one title, 822 against 3.5 samples at the peak. Level says
  // nothing about which master is better, so no winner.
  it('never ranks two different masters by level', () => {
    const a = { ...netzwerkAif, fingerprint: 'p', peakCount: 822.5, crestDb: 11 }
    const b = { ...netzwerkAif, fingerprint: 'q', peakCount: 3.5, crestDb: 11 }
    expect(compareCopies(a, b, otherMaster)).toEqual({ winner: 'tie' })
  })

  it('never ranks by level without the pair probe', () => {
    expect(compareCopies(netzwerkWav, netzwerkAif)).toEqual({ winner: 'tie' })
  })

  it('prefers lossless over lossy whatever the master', () => {
    const mp3 = { ...netzwerkAif, ext: 'mp3', cutoffHz: 19800, hasKnee: true, fingerprint: 'm' }
    expect(compareCopies(mp3, netzwerkWav, otherMaster)).toEqual({
      winner: 'b',
      reason: 'lossless',
    })
  })

  it('prefers the lossy copy with the clearly higher cutoff', () => {
    expect(
      compareCopies(
        { ext: 'mp3', cutoffHz: 16000, hasKnee: true },
        { ext: 'mp3', cutoffHz: 19800, hasKnee: true },
      ),
    ).toEqual({ winner: 'b', reason: 'cutoff' })
  })

  it('prefers the clean copy over a processed one', () => {
    expect(
      compareCopies({ ...netzwerkAif, processed: true, fingerprint: 'r' }, netzwerkAif),
    ).toEqual({ winner: 'b', reason: 'processed' })
  })

  // Louder is not better: a quieter copy with the same dynamics must not lose.
  it('never decides on loudness alone', () => {
    expect(
      compareCopies(
        netzwerkAif,
        { ...netzwerkAif, fingerprint: 'q', integratedLufs: -20 },
        sameMaster,
      ),
    ).toEqual({ winner: 'tie' })
  })

  // Night Power: peak counts within 3x, crest 3.8 dB apart.
  it('falls back to crest when the peak counts are close', () => {
    const a = { ...netzwerkAif, fingerprint: 's', peakCount: 1343.5, crestDb: 9.4 }
    const b = { ...netzwerkAif, fingerprint: 't', peakCount: 465, crestDb: 13.2 }
    expect(compareCopies(a, b, sameMaster)).toEqual({ winner: 'b', reason: 'crest' })
  })

  // Children: 0.2 LU apart, crest 1.18 dB the other way from the peak count. Not separable.
  it('calls a small crest gap a tie', () => {
    const a = { ...netzwerkAif, fingerprint: 's', peakCount: 1176, crestDb: 12 }
    const b = { ...netzwerkAif, fingerprint: 't', peakCount: 2706, crestDb: 13.18 }
    expect(compareCopies(a, b, sameMaster)).toEqual({ winner: 'tie' })
  })

  it('skips a criterion one side has not measured', () => {
    expect(
      compareCopies({ ...netzwerkWav, peakCount: null, crestDb: null }, netzwerkAif, sameMaster),
    ).toEqual({ winner: 'tie' })
  })
})

// The fingerprint decodes both copies to 16-bit 44.1 kHz, which flattens exactly the
// differences a hi-res or a real 24-bit copy is kept for. "Same audio" tells the user either
// copy will do, so it also needs the same rate and the same bits really in use.
describe('isSameAudio', () => {
  const at = (sampleRateHz: number, bitsUsage?: CopyFacts['bitsUsage']): CopyFacts => ({
    ...netzwerkAif,
    fingerprint: 'x',
    sampleRateHz,
    bitsUsage,
  })
  const shifted = { correlation: 1, residualDb: -85, gainDb: 0 }

  it('never calls a real 24-bit copy the same as a 16-bit one with the same MD5', () => {
    expect(isSameAudio(at(44100, 'full'), at(44100), null)).toBe(false)
  })

  it('never calls a 96 kHz copy the same as a 44.1 kHz one, however close the residual', () => {
    expect(isSameAudio(at(96000), { ...at(44100), fingerprint: 'y' }, shifted)).toBe(false)
  })

  // A 24-bit AIFF whose low byte is empty holds 16-bit audio: the container is all that differs.
  it('reads a padded 24-bit AIFF and its 16-bit WAV as the same audio', () => {
    expect(isSameAudio(at(44100, 'padded16'), { ...at(44100), ext: 'wav' }, null)).toBe(true)
  })

  // The scan could not tell whether the low byte carries signal, so the copy may be a real
  // 24-bit one; claiming it equals the 16-bit copy could send the user to delete it.
  it('never calls a 24-bit copy of unknown depth the same as a 16-bit one', () => {
    expect(isSameAudio(at(44100, 'unknown'), at(44100), null)).toBe(false)
  })

  it('reads two real 24-bit copies at one rate with the same MD5 as the same audio', () => {
    expect(isSameAudio(at(48000, 'full'), at(48000, 'full'), null)).toBe(true)
  })
})
