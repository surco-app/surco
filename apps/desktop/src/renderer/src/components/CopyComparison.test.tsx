// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import i18n from '../i18n'
import type { CopyFacts } from '../lib/bestCopy'
import { CopyComparison } from './CopyComparison'

afterEach(cleanup)
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

describe('CopyComparison', () => {
  // The verdict is only worth trusting if the user can see what it rests on: the sentence
  // states the measured difference, and the table colours the one figure that decided it so
  // the louder loudness reading (shown, never deciding) is not mistaken for the reason.
  it('argues the Netzwerk verdict with the measured numbers, colouring only the deciding rows', () => {
    render(
      <CopyComparison
        verdict={{ winner: 'a', reason: 'peakCount' }}
        here={aif}
        library={wav}
        hereLabel="AIF"
        libraryLabel="WAV"
      />,
    )
    expect(screen.getByTestId('copy-sentence')).toHaveTextContent(
      'The Apple Music copy is 2.2 dB louder, with 1978 samples pinned at its ceiling, the mark of a limiter.',
    )
    expect(screen.getByTestId('copy-row-peakCount')).toHaveAttribute('data-decides', 'true')
    expect(screen.getByTestId('copy-row-loudness')).not.toHaveAttribute('data-decides')
  })

  // A limiter does not always leave the copy louder; claiming "N dB louder" when it is not
  // would be a false statement, so the loudness clause drops instead.
  it('does not call the limited copy louder when it is not', () => {
    render(
      <CopyComparison
        verdict={{ winner: 'b', reason: 'peakCount' }}
        here={{ ...wav, integratedLufs: -12.2 }}
        library={{ ...aif, integratedLufs: -10 }}
        hereLabel="WAV"
        libraryLabel="AIF"
      />,
    )
    expect(screen.getByTestId('copy-sentence')).toHaveTextContent(
      'This file has 1978 samples pinned at its ceiling, the mark of a limiter.',
    )
  })

  // A limiter is inferred from the pinned samples, never measured; with no count to show,
  // the card can only say what the figures say, that this copy is more limited.
  it('does not claim a limiter when the pinned samples are not known', () => {
    render(
      <CopyComparison
        verdict={{ winner: 'b', reason: 'peakCount' }}
        here={{ ...wav, peakCount: null }}
        library={aif}
        hereLabel="WAV"
        libraryLabel="AIF"
      />,
    )
    expect(screen.getByTestId('copy-sentence')).toHaveTextContent('This file is more limited.')
  })

  // Lossy against lossless is a fact about the formats, not the cutoffs: a knee-less 16 kHz
  // WAV still beats a 20 kHz MP3, and quoting the cutoffs would argue the opposite.
  it('names the formats when a knee-less 16 kHz WAV beats a 20 kHz MP3', () => {
    render(
      <CopyComparison
        verdict={{ winner: 'a', reason: 'lossless' }}
        here={{ ...wav, cutoffHz: 16000 }}
        library={{ ...aif, ext: 'MP3', cutoffHz: 20000 }}
        hereLabel="WAV"
        libraryLabel="MP3"
      />,
    )
    expect(screen.getByTestId('copy-sentence')).toHaveTextContent(
      'The Apple Music copy is lossy (MP3). This file is lossless (WAV).',
    )
    expect(screen.getByTestId('copy-row-cutoff')).not.toHaveAttribute('data-decides')
  })

  it('names the formats when this file is the lossy one', () => {
    render(
      <CopyComparison
        verdict={{ winner: 'b', reason: 'lossless' }}
        here={{ ...aif, ext: 'MP3', cutoffHz: 16000 }}
        library={wav}
        hereLabel="MP3"
        libraryLabel="WAV"
      />,
    )
    expect(screen.getByTestId('copy-sentence')).toHaveTextContent(
      'This file is lossy (MP3). The Apple Music copy is lossless (WAV).',
    )
  })

  it('colours the cutoff row when the cutoff decided', () => {
    render(
      <CopyComparison
        verdict={{ winner: 'b', reason: 'cutoff' }}
        here={{ ...aif, ext: 'MP3', cutoffHz: 16000 }}
        library={{ ...wav, ext: 'MP3', cutoffHz: 19500 }}
        hereLabel="MP3"
        libraryLabel="MP3"
      />,
    )
    expect(screen.getByTestId('copy-sentence')).toHaveTextContent(
      'This file is cut at 16 kHz. The Apple Music copy reaches 19.5 kHz.',
    )
    expect(screen.getByTestId('copy-row-cutoff')).toHaveAttribute('data-decides', 'true')
  })

  // A transcode is called on the losing copy's knee alone, so the other copy's cutoff can be
  // unknown; the sentence drops the number instead of printing a placeholder.
  it('drops a cutoff it does not have instead of printing a placeholder', () => {
    render(
      <CopyComparison
        verdict={{ winner: 'b', reason: 'transcode' }}
        here={{ ...wav, cutoffHz: 16000, hasKnee: true }}
        library={{ ...aif, cutoffHz: undefined }}
        hereLabel="WAV"
        libraryLabel="AIF"
      />,
    )
    expect(screen.getByTestId('copy-sentence')).toHaveTextContent(
      'This file comes from a lossy source.',
    )
    expect(screen.getByTestId('copy-sentence').textContent).not.toContain('—')
  })

  it.each([
    'lossless',
    'transcode',
    'cutoff',
    'processed',
    'upsampled',
    'peakCount',
    'crest',
  ] as const)(
    'never prints a placeholder in the %s sentence when figures are missing',
    (reason) => {
      const bare = (f: CopyFacts): CopyFacts => ({ ext: f.ext })
      for (const winner of ['a', 'b'] as const) {
        render(
          <CopyComparison
            verdict={{ winner, reason }}
            here={bare(aif)}
            library={bare(wav)}
            hereLabel="AIF"
            libraryLabel="WAV"
          />,
        )
        const sentence = screen.getByTestId('copy-sentence').textContent ?? ''
        expect(sentence).not.toBe('')
        expect(sentence).not.toContain('—')
        expect(sentence).not.toContain('{{')
        cleanup()
      }
    },
  )

  // Every reason the comparison can return has to say something; a blank sentence under a
  // verdict would leave the user with a claim and no argument.
  it.each([
    'lossless',
    'transcode',
    'cutoff',
    'processed',
    'upsampled',
    'peakCount',
    'crest',
  ] as const)('writes a sentence for %s in both directions', (reason) => {
    for (const winner of ['a', 'b'] as const) {
      render(
        <CopyComparison
          verdict={{ winner, reason }}
          here={aif}
          library={wav}
          hereLabel="AIF"
          libraryLabel="WAV"
        />,
      )
      const sentence = screen.getByTestId('copy-sentence').textContent ?? ''
      expect(sentence).not.toBe('')
      expect(sentence).not.toContain('editor.')
      expect(sentence).not.toContain('{{')
      cleanup()
    }
  })

  // Same audio means either copy will do; a table of matching figures under that sentence
  // would only invite the reader to hunt for a difference that is not there.
  it('says the two copies are the same audio in one sentence, with no table', () => {
    render(
      <CopyComparison
        verdict={{ winner: 'same' }}
        here={aif}
        library={wav}
        hereLabel="AIF"
        libraryLabel="WAV"
      />,
    )
    expect(screen.getByTestId('copy-sentence')).toHaveTextContent(
      'Both copies hold the same samples at the same gain.',
    )
    expect(screen.queryByTestId('copy-row-cutoff')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  // A transcode is called on the losing copy's knee, so the winner may cut no higher (a
  // knee-less 15 kHz WAV); "the Apple Music copy reaches 15 kHz" would then argue the
  // opposite of the verdict.
  it('only says how far the winner reaches when it reaches higher', () => {
    const { rerender } = render(
      <CopyComparison
        verdict={{ winner: 'b', reason: 'transcode' }}
        here={{ ...wav, cutoffHz: 16000, hasKnee: true }}
        library={{ ...aif, cutoffHz: 15000, hasKnee: false }}
        hereLabel="WAV"
        libraryLabel="AIF"
      />,
    )
    expect(screen.getByTestId('copy-sentence')).toHaveTextContent(
      'This file comes from a lossy source.',
    )
    expect(screen.getByTestId('copy-sentence').textContent).not.toContain('15')
    rerender(
      <CopyComparison
        verdict={{ winner: 'b', reason: 'transcode' }}
        here={{ ...wav, cutoffHz: 16000, hasKnee: true }}
        library={{ ...aif, cutoffHz: 22050, hasKnee: false }}
        hereLabel="WAV"
        libraryLabel="AIF"
      />,
    )
    expect(screen.getByTestId('copy-sentence').textContent).toContain('reaches 22.1 kHz')
  })

  // 16 000 and 16 040 Hz both print as 16 kHz; "cut at 16 kHz, reaches 16 kHz" would argue
  // a difference the reader cannot see, so the figures drop.
  it('drops the cutoffs when they print as the same figure', () => {
    render(
      <CopyComparison
        verdict={{ winner: 'b', reason: 'transcode' }}
        here={{ ...wav, cutoffHz: 16000, hasKnee: true }}
        library={{ ...aif, cutoffHz: 16040, hasKnee: false }}
        hereLabel="WAV"
        libraryLabel="AIF"
      />,
    )
    expect(screen.getByTestId('copy-sentence')).toHaveTextContent(
      'This file comes from a lossy source.',
    )
  })

  // Audio quality calls a file with nothing above 22 kHz "probablemente reescalado"; the card
  // uses the same word and the same doubt so the two sections never seem to disagree.
  it('calls an upsampled copy probably reescalada, as Audio quality does', async () => {
    await i18n.changeLanguage('es')
    render(
      <CopyComparison
        verdict={{ winner: 'a', reason: 'upsampled' }}
        here={aif}
        library={wav}
        hereLabel="AIF"
        libraryLabel="WAV"
      />,
    )
    expect(screen.getByTestId('copy-sentence')).toHaveTextContent(
      'La copia de Apple Music probablemente está reescalada desde una frecuencia más baja. Este fichero no.',
    )
  })
})
