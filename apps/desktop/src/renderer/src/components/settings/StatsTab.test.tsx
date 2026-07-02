// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Settings } from '../../../../shared/types'
import '../../i18n'
import { StatsTab } from './StatsTab'

afterEach(cleanup)

const settings = { conversionCount: 3 } as Settings

const listStats = {
  total: 10,
  analyzed: 6,
  suspect: 2,
  converted: 4,
  duplicates: 2,
  formats: [
    { format: 'WAV', count: 7 },
    { format: 'FLAC', count: 3 },
  ],
}

describe('StatsTab current list summary', () => {
  // The stats view is where the cleanup flow's sense of progress lives: alongside the
  // lifetime counter it must say how far the CURRENT list has come — how much is
  // analyzed, flagged and converted — so "am I done with this batch?" has an answer.
  it('summarizes the loaded list next to the lifetime counter', () => {
    render(<StatsTab settings={settings} listStats={listStats} />)
    const list = screen.getByTestId('stats-list')
    expect(list).toHaveTextContent('10')
    expect(screen.getByTestId('stats-list-analyzed')).toHaveTextContent('6/10')
    expect(screen.getByTestId('stats-list-suspect')).toHaveTextContent('2')
    expect(screen.getByTestId('stats-list-converted')).toHaveTextContent('4/10')
    expect(screen.getByTestId('stats-list-formats')).toHaveTextContent('WAV 7 · FLAC 3')
  })

  // An empty list has nothing to summarize; the lifetime stats stand alone.
  it('shows no list section while nothing is loaded', () => {
    render(
      <StatsTab
        settings={settings}
        listStats={{ total: 0, analyzed: 0, suspect: 0, converted: 0, duplicates: 0, formats: [] }}
      />,
    )
    expect(screen.queryByTestId('stats-list')).toBeNull()
    expect(screen.getByTestId('stats-count')).toBeInTheDocument()
  })
})
