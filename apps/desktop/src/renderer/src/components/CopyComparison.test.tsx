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
        libraryName="Apple Music"
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

  it('names the library it compares with in the table', () => {
    render(
      <CopyComparison
        libraryName="rekordbox"
        verdict={{ winner: 'a', reason: 'peakCount' }}
        here={aif}
        library={wav}
        hereLabel="AIF"
        libraryLabel="WAV"
      />,
    )
    expect(screen.getByRole('columnheader', { name: 'rekordbox · WAV' })).toBeInTheDocument()
    expect(screen.queryByText(/Apple Music/)).toBeNull()
  })

  // Only the figure that carried the verdict is marked, and only on the side that won, in the
  // verdict's own colour: the louder loudness reading (shown, never deciding) must not be
  // mistaken for the reason, and a coloured loser read as a second verdict.
  it('marks the winning figure of the deciding row as this file when it wins', () => {
    render(
      <CopyComparison
        libraryName="Apple Music"
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
        libraryName="Apple Music"
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

  // A lossy source is read off the spectrum, and the cutoffs are the evidence of it: the copy
  // that reaches higher is marked as the one that won.
  it.each([
    ['a', 'here', '22.1 kHz'],
    ['b', 'library', '22.1 kHz'],
  ] as const)(
    'marks the higher cutoff when a lossy source decided for %s',
    (winner, side, figure) => {
      const lossy = { ...wav, cutoffHz: 16000, hasKnee: true }
      const clean = { ...aif, cutoffHz: 22050 }
      render(
        <CopyComparison
          libraryName="Apple Music"
          verdict={{ winner, reason: 'transcode' }}
          here={winner === 'a' ? clean : lossy}
          library={winner === 'a' ? lossy : clean}
          hereLabel="AIF"
          libraryLabel="WAV"
        />,
      )
      const row = screen.getByTestId('copy-row-cutoff')
      expect(row).toHaveAttribute('data-decides', 'true')
      expect(within(row).getByText(figure)).toHaveAttribute('data-winner', side)
      expect(winners()).toEqual([side])
    },
  )

  // A transcode is called on the losing copy's knee alone, so the winner may cut no higher
  // (a knee-less 15 kHz WAV). Marking its lower figure would argue the opposite of the verdict.
  it('marks no cutoff when the winner of a lossy source does not reach higher', () => {
    render(
      <CopyComparison
        libraryName="Apple Music"
        verdict={{ winner: 'b', reason: 'transcode' }}
        here={{ ...wav, cutoffHz: 16000, hasKnee: true }}
        library={{ ...aif, cutoffHz: 15000 }}
        hereLabel="WAV"
        libraryLabel="AIF"
      />,
    )
    expect(screen.getByTestId('copy-row-cutoff')).not.toHaveAttribute('data-decides')
    expect(winners()).toEqual([])
  })

  // Lossy against lossless is a fact about the formats, not the cutoffs: a knee-less 16 kHz
  // WAV still beats a 20 kHz MP3, and marking the higher cutoff would argue the opposite.
  it('marks no figure when the formats decided', () => {
    render(
      <CopyComparison
        libraryName="Apple Music"
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
  // Another version differs in what was cut, not in how it was mastered: the lengths side by
  // side say it at once, 8:03 here against 7:28 in the library, and no figure wins.
  it('puts the two lengths side by side for another version, marking no winner', () => {
    render(
      <CopyComparison
        libraryName="Apple Music"
        verdict={{ winner: 'different' }}
        here={aif}
        library={wav}
        hereLabel="AIF"
        libraryLabel="WAV 16/44.1"
        hereDurationSec={483.2}
        libraryDurationSec={447.9}
      />,
    )
    const row = screen.getByTestId('copy-row-duration')
    expect(
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['8:03', '7:27'])
    expect(within(row).getByRole('rowheader')).toHaveTextContent('Duration')
    expect(winners()).toEqual([])
  })

  // Two copies of one master that nothing separates: the reader gets the figures to decide,
  // with no row claiming to have decided.
  it('shows the figures of two alike copies with no deciding row', () => {
    render(
      <CopyComparison
        libraryName="Apple Music"
        verdict={{ winner: 'tie' }}
        here={aif}
        library={wav}
        hereLabel="AIF"
        libraryLabel="WAV"
        hereDurationSec={483}
        libraryDurationSec={483}
      />,
    )
    expect(screen.getByTestId('copy-row-crest')).toBeInTheDocument()
    expect(screen.queryByTestId('copy-row-duration')).toBeNull()
    expect(winners()).toEqual([])
    expect(screen.getAllByRole('row').some((r) => r.hasAttribute('data-decides'))).toBe(false)
  })
})
