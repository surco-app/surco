import { describe, expect, it } from 'vitest'
import { replaceWarning } from './replaceWarning'

// Whether swapping the library copy for the new file gives something up. The user's rule:
// warn, never block — the decision stays theirs, this only makes sure it is informed.

describe('replaceWarning', () => {
  it('says nothing when a lossy copy is replaced by a lossless one', () => {
    expect(replaceWarning({ ext: 'mp3' }, { ext: 'wav' })).toBeNull()
  })

  it('says nothing when both are lossless', () => {
    expect(replaceWarning({ ext: 'wav' }, { ext: 'aiff' })).toBeNull()
  })

  // The clearest loss there is: a lossless master traded for a lossy file. 1702 of the
  // user's 1959 library tracks are lossless, so this is the case that protects most of
  // their collection.
  it('warns when a lossless copy would become lossy', () => {
    expect(replaceWarning({ ext: 'wav' }, { ext: 'mp3' })).toEqual({ reason: 'lossless-to-lossy' })
  })

  // Both lossy, but the new one is cut lower: a 128 kbps rip replacing a 320. The
  // container alone cannot tell them apart, the measured cutoff can.
  it('warns when both are lossy and the new one is cut lower', () => {
    expect(
      replaceWarning({ ext: 'mp3', cutoffHz: 20000 }, { ext: 'mp3', cutoffHz: 16000 }),
    ).toEqual({ reason: 'lower-cutoff' })
  })

  it('says nothing when the new lossy file is cut higher', () => {
    expect(
      replaceWarning({ ext: 'mp3', cutoffHz: 16000 }, { ext: 'mp3', cutoffHz: 20000 }),
    ).toBeNull()
  })

  // A lossless container whose spectrum still carries a codec lowpass: a lossy file
  // re-encoded as WAV. It looks like an upgrade and is not one, which is exactly why it
  // has to be said out loud.
  it('warns when the new file is a lossless container around a lossy source', () => {
    expect(replaceWarning({ ext: 'mp3' }, { ext: 'wav', cutoffHz: 16000, hasKnee: true })).toEqual({
      reason: 'transcode',
    })
  })

  // A genuine dark master has no knee, and calling it a fake would cry wolf on real
  // lossless files.
  it('does not call a knee-free lossless file a transcode', () => {
    expect(
      replaceWarning({ ext: 'mp3' }, { ext: 'wav', cutoffHz: 16000, hasKnee: false }),
    ).toBeNull()
  })

  // Comparing cutoffs needs both numbers; without them the container comparison is all
  // there is, and inventing a verdict from one measurement would be guesswork.
  it('falls back to the containers when a cutoff is missing', () => {
    expect(replaceWarning({ ext: 'mp3' }, { ext: 'mp3', cutoffHz: 16000 })).toBeNull()
    expect(replaceWarning({ ext: 'mp3', cutoffHz: 20000 }, { ext: 'mp3' })).toBeNull()
  })

  // .m4a holds AAC or ALAC, and the extension cannot say which. Guessing either way would
  // warn on real upgrades or stay silent on real losses, so it warns on neither.
  it('stays quiet about m4a, which the extension cannot classify', () => {
    expect(replaceWarning({ ext: 'wav' }, { ext: 'm4a' })).toBeNull()
    expect(replaceWarning({ ext: 'm4a' }, { ext: 'mp3' })).toBeNull()
  })

  // A small difference in cutoff is measurement noise, not a downgrade: the spectrum
  // measurement carries a few hundred Hz of spread on the same file.
  it('ignores a cutoff difference too small to mean anything', () => {
    expect(
      replaceWarning({ ext: 'mp3', cutoffHz: 20000 }, { ext: 'mp3', cutoffHz: 19800 }),
    ).toBeNull()
  })

  // The measured shape of the case this rule exists for. A 320 kbps rip lands near
  // 20 kHz and a 128 near 16 kHz — well clear of the detector's own spread, so the
  // downgrade is real and must be said. Two 320s of the same track land within that
  // spread of each other and must not be.
  it('warns for a real 320-to-128 downgrade but not between two 320s', () => {
    expect(
      replaceWarning({ ext: 'mp3', cutoffHz: 20000 }, { ext: 'mp3', cutoffHz: 16000 }),
    ).toEqual({ reason: 'lower-cutoff' })
    expect(
      replaceWarning({ ext: 'mp3', cutoffHz: 20100 }, { ext: 'mp3', cutoffHz: 19600 }),
    ).toBeNull()
  })
})
