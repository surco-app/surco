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
      'The Apple Music copy is 2.2 dB louder and went through a limiter, with 1978 samples pinned at its ceiling.',
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
      'This file went through a limiter, with 1978 samples pinned at its ceiling.',
    )
  })

  it('names the lossy side and both cutoffs when the lossless copy wins', () => {
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
      'This file is lossy with its cutoff at 16 kHz. The Apple Music copy reaches 22.1 kHz.',
    )
    expect(screen.getByTestId('copy-row-cutoff')).toHaveAttribute('data-decides', 'true')
  })

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

  it('says the two copies are the same audio and no difference on a tie', () => {
    const { rerender } = render(
      <CopyComparison
        verdict={{ winner: 'same' }}
        here={aif}
        library={wav}
        hereLabel="AIF"
        libraryLabel="WAV"
      />,
    )
    expect(screen.getByTestId('copy-sentence')).toHaveTextContent(
      'Same samples, same gain. Only the container differs.',
    )
    rerender(
      <CopyComparison
        verdict={{ winner: 'tie' }}
        here={aif}
        library={wav}
        hereLabel="AIF"
        libraryLabel="WAV"
      />,
    )
    expect(screen.getByTestId('copy-sentence')).toHaveTextContent(
      'No measured difference between the two copies.',
    )
  })
})
