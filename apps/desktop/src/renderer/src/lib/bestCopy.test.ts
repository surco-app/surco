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
  // nothing about which master is better, so no winner; at 0.86 they still share an edit,
  // so "another version" would be a claim the probe does not support.
  it('never ranks two different masters by level', () => {
    const a = { ...netzwerkAif, fingerprint: 'p', peakCount: 822.5, crestDb: 11 }
    const b = { ...netzwerkAif, fingerprint: 'q', peakCount: 3.5, crestDb: 11 }
    expect(compareCopies(a, b, otherMaster)).toEqual({ winner: 'tie' })
  })

  describe('another version', () => {
    const edit = (durationSec: number, integratedLufs = -9): CopyFacts => ({
      ...netzwerkAif,
      fingerprint: `e${durationSec}`,
      durationSec,
      integratedLufs,
    })
    const searched = (versionCorrelation: number) => ({ versionCorrelation })

    // 3 Ways: two lossless edits, 447 s and 483 s, that the ±1 s probe could not line up and
    // the wider search found nothing between. Saying nothing hid another version.
    it('calls two edits the wider search found no match between different', () => {
      expect(compareCopies(edit(447), edit(483), searched(0.19))).toEqual({ winner: 'different' })
      expect(
        compareCopies(edit(447), edit(483), {
          correlation: 0.3,
          residualDb: -1,
          gainDb: -6,
          versionCorrelation: 0.19,
        }),
      ).toEqual({ winner: 'different' })
    })

    // A 30 s Music copy against a 95 s file: the wider search stops at about 54 s, so nothing
    // was measured and the row stayed blank. One master cannot carry that much more audio than
    // the other, so the lengths alone say it is another version, with or without a probe.
    it.each([null, { correlation: 0.1, residualDb: -1, gainDb: -3 }] as const)(
      'calls copies further apart than the wider search reaches another version from their lengths (%j)',
      (pair) => {
        expect(compareCopies(edit(95), edit(30), pair)).toEqual({ winner: 'different' })
      },
    )

    it('keeps measuring while the pair is still being read, however far apart the lengths are', () => {
      expect(compareCopies(edit(95), edit(30), undefined)).toEqual({ winner: 'tie' })
    })

    it('never calls a copy too short to hold a track another version from its length alone', () => {
      expect(compareCopies(edit(95), edit(4), null)).toEqual({ winner: 'tie' })
    })

    // One master with 3 s of its head trimmed is 3 s shorter and slips past the ±1 s probe;
    // the wider search lines it up again, so it is no other version.
    it('never calls a shifted copy of one master another version', () => {
      expect(compareCopies(edit(447), edit(450), searched(0.97))).toEqual({ winner: 'tie' })
    })

    // Without the wider search there is no evidence the audio differs.
    it('never calls copies another version without the wider search', () => {
      expect(compareCopies(edit(447), edit(483), null)).toEqual({ winner: 'tie' })
      expect(
        compareCopies(edit(447), edit(483), { correlation: 0.1, residualDb: -0.1, gainDb: -9 }),
      ).toEqual({ winner: 'tie' })
    })

    // PG2 Hey-Heeey: one master drifting against itself correlated 0.067. A length within 2 s
    // is what a drift leaves, and calling it another version would be false.
    it('never calls copies of nearly the same length another version', () => {
      expect(compareCopies(edit(447), edit(448.9), searched(0.05))).toEqual({ winner: 'tie' })
    })

    it('never calls a correlation of 0.5 or more another version', () => {
      expect(compareCopies(edit(447), edit(483), searched(0.5))).toEqual({ winner: 'tie' })
    })

    it('never calls a short or silent copy another version', () => {
      expect(compareCopies(edit(9.9), edit(483), searched(0.1))).toEqual({ winner: 'tie' })
      expect(compareCopies(edit(447), edit(483, -71), searched(0.1))).toEqual({ winner: 'tie' })
    })

    it('never calls copies of unknown length another version', () => {
      const a = { ...netzwerkAif, fingerprint: 'p' }
      const b = { ...netzwerkAif, fingerprint: 'q' }
      expect(compareCopies(a, b, searched(0.1))).toEqual({ winner: 'tie' })
    })
  })

  // «Parecidas» claims one master: only a tie whose pair correlated at or above the
  // same-master line carries that evidence.
  describe('same master', () => {
    it('marks a tie of one master that nothing separates', () => {
      expect(compareCopies(netzwerkAif, { ...netzwerkAif, fingerprint: 'q' }, sameMaster)).toEqual({
        winner: 'tie',
        sameMaster: true,
      })
    })

    it('leaves a tie without that evidence unmarked', () => {
      expect(compareCopies(netzwerkAif, { ...netzwerkAif, fingerprint: 'q' }, otherMaster)).toEqual(
        { winner: 'tie' },
      )
      expect(compareCopies(netzwerkAif, { ...netzwerkAif, fingerprint: 'q' }, null)).toEqual({
        winner: 'tie',
      })
      expect(compareCopies(netzwerkAif, { ...netzwerkAif, fingerprint: 'q' })).toEqual({
        winner: 'tie',
      })
    })
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
    ).toEqual({ winner: 'tie', sameMaster: true })
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
    expect(compareCopies(a, b, sameMaster)).toEqual({ winner: 'tie', sameMaster: true })
  })

  it('skips a criterion one side has not measured', () => {
    expect(
      compareCopies({ ...netzwerkWav, peakCount: null, crestDb: null }, netzwerkAif, sameMaster),
    ).toEqual({ winner: 'tie', sameMaster: true })
  })
})

describe('compareCopies, every branch and both directions', () => {
  const lossless = { ...netzwerkAif, fingerprint: 'l' }
  const transcoded = { ...netzwerkWav, cutoffHz: 16000, hasKnee: true, fingerprint: 't' }
  const level = (peakCount: number, crestDb: number): CopyFacts => ({
    ...netzwerkAif,
    fingerprint: `${peakCount}/${crestDb}`,
    peakCount,
    crestDb,
  })

  // A WAV built from an MP3 looks lossless by its extension; its knee gives it away, and
  // either side of the comparison can be the one holding it.
  it('prefers the true lossless copy over a lossy source in a lossless container', () => {
    expect(compareCopies(transcoded, lossless, otherMaster)).toEqual({
      winner: 'b',
      reason: 'transcode',
    })
    expect(compareCopies(lossless, transcoded, otherMaster)).toEqual({
      winner: 'a',
      reason: 'transcode',
    })
  })

  it('prefers the copy at its native rate over an upsampled one, in either order', () => {
    const up = { ...lossless, fingerprint: 'u', upsampled: true }
    expect(compareCopies(up, lossless)).toEqual({ winner: 'b', reason: 'upsampled' })
    expect(compareCopies(lossless, up)).toEqual({ winner: 'a', reason: 'upsampled' })
  })

  it('names reprocessing before upsampling when a copy carries both', () => {
    const both = { ...lossless, fingerprint: 'x', processed: true, upsampled: true }
    expect(compareCopies(lossless, both)).toEqual({ winner: 'a', reason: 'processed' })
  })

  it('lets this side win on the level criteria too', () => {
    expect(compareCopies(netzwerkAif, netzwerkWav, sameMaster)).toEqual({
      winner: 'a',
      reason: 'peakCount',
    })
    expect(compareCopies(level(465, 13.2), level(1343.5, 9.4), sameMaster)).toEqual({
      winner: 'a',
      reason: 'crest',
    })
  })

  // The margins are where the 26 measured pairs drew the line; one step either side of
  // each must land on its own side of it.
  it('decides on a peak count ratio of exactly 10 and not just under it', () => {
    expect(compareCopies(level(9, 12), level(99, 12), sameMaster)).toEqual({
      winner: 'a',
      reason: 'peakCount',
    })
    expect(compareCopies(level(9, 12), level(98, 12), sameMaster)).toEqual({
      winner: 'tie',
      sameMaster: true,
    })
  })

  it('decides on a crest gap of exactly 1.5 dB and not just under it', () => {
    expect(compareCopies(level(10, 12), level(10, 13.5), sameMaster)).toEqual({
      winner: 'b',
      reason: 'crest',
    })
    expect(compareCopies(level(10, 12), level(10, 13.49), sameMaster)).toEqual({
      winner: 'tie',
      sameMaster: true,
    })
  })

  it('reads a correlation of exactly 0.98 as one master and just under it as two', () => {
    const at = (correlation: number) => ({ correlation, residualDb: -20, gainDb: -1 })
    expect(compareCopies(netzwerkWav, netzwerkAif, at(0.98))).toEqual({
      winner: 'b',
      reason: 'peakCount',
    })
    expect(compareCopies(netzwerkWav, netzwerkAif, at(0.979))).toEqual({ winner: 'tie' })
  })

  it('calls a residual of -60 dB the same audio and -59.9 dB not', () => {
    const b = { ...lossless, fingerprint: 'other' }
    expect(compareCopies(lossless, b, { correlation: 1, residualDb: -60, gainDb: 0 })).toEqual({
      winner: 'same',
    })
    expect(compareCopies(lossless, b, { correlation: 1, residualDb: -59.9, gainDb: 0 })).toEqual({
      winner: 'tie',
      sameMaster: true,
    })
  })

  // The same audio means the same gain, whichever copy is the louder one.
  it('calls a gain of 0.009 dB the same audio and 0.01 dB not, either sign', () => {
    const b = { ...lossless, fingerprint: 'other' }
    const pair = (gainDb: number) => ({ correlation: 1, residualDb: -80, gainDb })
    expect(compareCopies(lossless, b, pair(0.009))).toEqual({ winner: 'same' })
    expect(compareCopies(lossless, b, pair(-0.009))).toEqual({ winner: 'same' })
    expect(compareCopies(lossless, b, pair(0.01))).toEqual({ winner: 'tie', sameMaster: true })
    expect(compareCopies(lossless, b, pair(-0.01))).toEqual({ winner: 'tie', sameMaster: true })
  })

  // One copy measured and the other not is partial data: the measured figure alone must
  // not read as a gap of 1000 samples or 12 dB against nothing.
  it('skips a level criterion only one side has measured, from either side', () => {
    const missingPeaks = { ...level(1000, 12), fingerprint: 'p', peakCount: null }
    expect(compareCopies(missingPeaks, level(1000, 12), sameMaster)).toEqual({
      winner: 'tie',
      sameMaster: true,
    })
    expect(compareCopies(level(1000, 12), missingPeaks, sameMaster)).toEqual({
      winner: 'tie',
      sameMaster: true,
    })
    const missingCrest = { ...level(10, 12), fingerprint: 'c', crestDb: null }
    expect(compareCopies(missingCrest, level(10, 12), sameMaster)).toEqual({
      winner: 'tie',
      sameMaster: true,
    })
    expect(compareCopies(level(10, 12), missingCrest, sameMaster)).toEqual({
      winner: 'tie',
      sameMaster: true,
    })
  })

  // Two files that both failed to fingerprint share no MD5; null must not equal null.
  it('never reads two missing fingerprints as the same audio', () => {
    expect(
      compareCopies({ ...lossless, fingerprint: null }, { ...lossless, fingerprint: null }),
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

  // Two copies the scan could not call may each be real 24-bit or padded; a 16-bit MD5
  // match cannot tell them apart, so unknown matches nothing, not even another unknown.
  it('never calls two copies of unknown depth the same audio', () => {
    expect(isSameAudio(at(44100, 'unknown'), at(44100, 'unknown'), null)).toBe(false)
  })

  it('reads two real 24-bit copies at one rate with the same MD5 as the same audio', () => {
    expect(isSameAudio(at(48000, 'full'), at(48000, 'full'), null)).toBe(true)
  })
})
