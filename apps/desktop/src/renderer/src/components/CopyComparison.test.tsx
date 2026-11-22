// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
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

function winners(): (string | null)[] {
  return screen
    .getAllByRole('cell')
    .map((cell) => cell.getAttribute('data-winner'))
    .filter((w) => w !== null)
}

describe('CopyComparison', () => {
  // The table is the argument now: a sentence above it said the same figures in words, a
  // second telling that made the section read as a wall of text.
  it('shows the table with no sentence above it', () => {
    render(
      <CopyComparison
        verdict={{ winner: 'a', reason: 'peakCount' }}
        here={aif}
        library={wav}
        hereLabel="AIF"
        libraryLabel="WAV"
      />,
    )
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.queryByTestId('copy-sentence')).toBeNull()
    expect(screen.getByTestId('copy-comparison')).not.toHaveTextContent('limiter')
  })

  // Only the figure that carried the verdict is marked, and only on the side that won, in the
  // verdict's own colour: the louder loudness reading (shown, never deciding) must not be
  // mistaken for the reason, and a coloured loser read as a second verdict.
  it('marks the winning figure of the deciding row as this file when it wins', () => {
    render(
      <CopyComparison
        verdict={{ winner: 'a', reason: 'peakCount' }}
        here={aif}
        library={wav}
        hereLabel="AIF"
        libraryLabel="WAV"
      />,
    )
    const row = screen.getByTestId('copy-row-peakCount')
    expect(row).toHaveAttribute('data-decides', 'true')
    expect(within(row).getByText('2')).toHaveAttribute('data-winner', 'here')
    expect(within(row).getByText('1978')).not.toHaveAttribute('data-winner')
    expect(screen.getByTestId('copy-row-loudness')).not.toHaveAttribute('data-decides')
    expect(winners()).toEqual(['here'])
  })

  it('marks the winning figure of the deciding row as the library when it wins', () => {
    render(
      <CopyComparison
        verdict={{ winner: 'b', reason: 'cutoff' }}
        here={{ ...aif, ext: 'MP3', cutoffHz: 16000 }}
        library={{ ...wav, ext: 'MP3', cutoffHz: 19500 }}
        hereLabel="MP3"
        libraryLabel="MP3"
      />,
    )
    const row = screen.getByTestId('copy-row-cutoff')
    expect(within(row).getByText('19.5 kHz')).toHaveAttribute('data-winner', 'library')
    expect(winners()).toEqual(['library'])
  })

  // Lossy against lossless is a fact about the formats, not the cutoffs: a knee-less 16 kHz
  // WAV still beats a 20 kHz MP3, and marking the higher cutoff would argue the opposite.
  it('marks no figure when the formats decided', () => {
    render(
      <CopyComparison
        verdict={{ winner: 'a', reason: 'lossless' }}
        here={{ ...wav, cutoffHz: 16000 }}
        library={{ ...aif, ext: 'MP3', cutoffHz: 20000 }}
        hereLabel="WAV"
        libraryLabel="MP3"
      />,
    )
    expect(screen.getByTestId('copy-row-cutoff')).not.toHaveAttribute('data-decides')
    expect(winners()).toEqual([])
  })
})
