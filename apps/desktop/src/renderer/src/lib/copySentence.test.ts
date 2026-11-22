import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../i18n'
import type { CopyFacts, CopyReason } from './bestCopy'
import { copySentence } from './copySentence'

beforeEach(() => void i18n.changeLanguage('en'))

const wav: CopyFacts = {
  ext: 'WAV',
  cutoffHz: 22050,
  hasKnee: false,
  fingerprint: 'w',
  peakCount: 1978,
  crestDb: 10.7,
  integratedLufs: -10,
}
const aif: CopyFacts = {
  ext: 'AIF',
  cutoffHz: 22050,
  hasKnee: false,
  fingerprint: 'a',
  peakCount: 2,
  crestDb: 13.2,
  integratedLufs: -12.2,
}

const say = (
  verdict: { winner: 'a' | 'b'; reason: CopyReason },
  here: CopyFacts,
  library: CopyFacts,
): string => copySentence(verdict, here, library, i18n.t, i18n.language)

const REASONS = [
  'lossless',
  'transcode',
  'cutoff',
  'processed',
  'upsampled',
  'peakCount',
  'crest',
] as const

describe('copySentence', () => {
  // The verdict is only worth trusting if the user can see what it rests on: the sentence
  // states the measured difference behind it.
  it('argues the Netzwerk verdict with the measured numbers', () => {
    expect(say({ winner: 'a', reason: 'peakCount' }, aif, wav)).toBe(
      'The Apple Music copy is 2.2 dB louder, with 1978 samples pinned at its ceiling, the mark of a limiter.',
    )
  })

  // A limiter does not always leave the copy louder; claiming "N dB louder" when it is not
  // would be a false statement, so the loudness clause drops instead.
  it('does not call the limited copy louder when it is not', () => {
    expect(
      say(
        { winner: 'b', reason: 'peakCount' },
        { ...wav, integratedLufs: -12.2 },
        { ...aif, integratedLufs: -10 },
      ),
    ).toBe('This file has 1978 samples pinned at its ceiling, the mark of a limiter.')
  })

  // A limiter is inferred from the pinned samples, never measured; with no count to show,
  // the sentence can only say what the figures say, that this copy is more limited.
  it('does not claim a limiter when the pinned samples are not known', () => {
    expect(say({ winner: 'b', reason: 'peakCount' }, { ...wav, peakCount: null }, aif)).toBe(
      'This file is more limited.',
    )
  })

  // Lossy against lossless is a fact about the formats, not the cutoffs: a knee-less 16 kHz
  // WAV still beats a 20 kHz MP3, and quoting the cutoffs would argue the opposite.
  it('names the formats when a knee-less 16 kHz WAV beats a 20 kHz MP3', () => {
    expect(
      say(
        { winner: 'a', reason: 'lossless' },
        { ...wav, cutoffHz: 16000 },
        { ...aif, ext: 'MP3', cutoffHz: 20000 },
      ),
    ).toBe('The Apple Music copy is lossy (MP3). This file is lossless (WAV).')
  })

  it('names the formats when this file is the lossy one', () => {
    expect(
      say({ winner: 'b', reason: 'lossless' }, { ...aif, ext: 'MP3', cutoffHz: 16000 }, wav),
    ).toBe('This file is lossy (MP3). The Apple Music copy is lossless (WAV).')
  })

  it('quotes both cutoffs when the cutoff decided', () => {
    expect(
      say(
        { winner: 'b', reason: 'cutoff' },
        { ...aif, ext: 'MP3', cutoffHz: 16000 },
        { ...wav, ext: 'MP3', cutoffHz: 19500 },
      ),
    ).toBe('This file is cut at 16 kHz. The Apple Music copy reaches 19.5 kHz.')
  })

  // A transcode is called on the losing copy's knee alone, so the other copy's cutoff can be
  // unknown; the sentence drops the number instead of printing a placeholder.
  it('drops a cutoff it does not have instead of printing a placeholder', () => {
    const sentence = say(
      { winner: 'b', reason: 'transcode' },
      { ...wav, cutoffHz: 16000, hasKnee: true },
      { ...aif, cutoffHz: undefined },
    )
    expect(sentence).toBe('This file comes from a lossy source.')
    expect(sentence).not.toContain('—')
  })

  it.each(REASONS)(
    'never prints a placeholder in the %s sentence when figures are missing',
    (reason) => {
      const bare = (f: CopyFacts): CopyFacts => ({ ext: f.ext })
      for (const winner of ['a', 'b'] as const) {
        const sentence = say({ winner, reason }, bare(aif), bare(wav))
        expect(sentence).not.toBe('')
        expect(sentence).not.toContain('—')
        expect(sentence).not.toContain('{{')
      }
    },
  )

  // Every reason the comparison can return has to say something; a verdict with no
  // argument would leave the user with a claim and nothing behind it.
  it.each(REASONS)('writes a sentence for %s in both directions', (reason) => {
    for (const winner of ['a', 'b'] as const) {
      const sentence = say({ winner, reason }, aif, wav)
      expect(sentence).not.toBe('')
      expect(sentence).not.toContain('editor.')
      expect(sentence).not.toContain('{{')
    }
  })

  // A transcode is called on the losing copy's knee, so the winner may cut no higher (a
  // knee-less 15 kHz WAV); "the Apple Music copy reaches 15 kHz" would then argue the
  // opposite of the verdict.
  it('only says how far the winner reaches when it reaches higher', () => {
    const lower = say(
      { winner: 'b', reason: 'transcode' },
      { ...wav, cutoffHz: 16000, hasKnee: true },
      { ...aif, cutoffHz: 15000, hasKnee: false },
    )
    expect(lower).toBe('This file comes from a lossy source.')
    expect(lower).not.toContain('15')
    expect(
      say(
        { winner: 'b', reason: 'transcode' },
        { ...wav, cutoffHz: 16000, hasKnee: true },
        { ...aif, cutoffHz: 22050, hasKnee: false },
      ),
    ).toContain('reaches 22.1 kHz')
  })

  // 16 000 and 16 040 Hz both print as 16 kHz; "cut at 16 kHz, reaches 16 kHz" would argue
  // a difference the reader cannot see, so the figures drop.
  it('drops the cutoffs when they print as the same figure', () => {
    expect(
      say(
        { winner: 'b', reason: 'transcode' },
        { ...wav, cutoffHz: 16000, hasKnee: true },
        { ...aif, cutoffHz: 16040, hasKnee: false },
      ),
    ).toBe('This file comes from a lossy source.')
  })

  // Audio quality calls a file with nothing above 22 kHz "probablemente reescalado"; the
  // verdict uses the same word and the same doubt so the two sections never seem to disagree.
  it('calls an upsampled copy probably reescalada, as Audio quality does', async () => {
    await i18n.changeLanguage('es')
    expect(say({ winner: 'a', reason: 'upsampled' }, aif, wav)).toBe(
      'La copia de Apple Music probablemente está reescalada desde una frecuencia más baja. Este archivo no.',
    )
  })
})
