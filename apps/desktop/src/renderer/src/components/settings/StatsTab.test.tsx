// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Settings } from '../../../../shared/types'
import '../../i18n'
import { StatsTab } from './StatsTab'

afterEach(cleanup)

const zeroStats = {
  imported: 0,
  listened: 0,
  analyzed: 0,
  discogsMatches: 0,
  bandcampMatches: 0,
  deezerMatches: 0,
}

function withStats(over: Partial<Settings> = {}): Settings {
  return { conversionCount: 0, stats: zeroStats, ...over } as Settings
}

describe('StatsTab', () => {
  // The lifetime counter is the tab's centerpiece: it turns "I used the app" into a
  // number the user can feel good about, right next to the donate ask.
  it('shows the lifetime conversion counter and time saved', () => {
    render(<StatsTab settings={withStats({ conversionCount: 3 })} />)
    expect(screen.getByTestId('stats-count')).toHaveTextContent('3')
    expect(screen.getByTestId('stats-time-saved')).toBeInTheDocument()
    expect(screen.getByTestId('stats-donate')).toBeInTheDocument()
  })

  // The activity grid answers "what has Surco done for me" beyond conversions —
  // loads, listens, analyses and per-provider match finds each get their own tally.
  it('shows every lifetime activity counter', () => {
    render(
      <StatsTab
        settings={withStats({
          conversionCount: 385,
          stats: {
            imported: 812,
            listened: 240,
            analyzed: 512,
            discogsMatches: 301,
            bandcampMatches: 17,
            deezerMatches: 44,
          },
        })}
      />,
    )
    expect(screen.getByTestId('stats-imported')).toHaveTextContent('812')
    expect(screen.getByTestId('stats-listened')).toHaveTextContent('240')
    expect(screen.getByTestId('stats-analyzed')).toHaveTextContent('512')
    expect(screen.getByTestId('stats-discogsMatches')).toHaveTextContent('301')
    expect(screen.getByTestId('stats-bandcampMatches')).toHaveTextContent('17')
    expect(screen.getByTestId('stats-deezerMatches')).toHaveTextContent('44')
  })

  // The match tallies aren't independent trivia — together they answer "where did my
  // metadata come from", so they read as one proportion. The split bar sizes each
  // source to its share of the matches found, with the raw counts still legible.
  it('splits the match sources by their share of the matches found', () => {
    render(
      <StatsTab
        settings={withStats({
          conversionCount: 50,
          stats: { ...zeroStats, discogsMatches: 30, bandcampMatches: 10, deezerMatches: 10 },
        })}
      />,
    )
    const split = screen.getByTestId('stats-match-split')
    // Discogs is 30 of 50 matches → its segment fills three-fifths of the bar.
    const discogs = screen.getByTestId('stats-match-discogs')
    expect(discogs).toHaveStyle({ width: '60%' })
    const deezer = screen.getByTestId('stats-match-deezer')
    expect(deezer).toHaveStyle({ width: '20%' })
    expect(split).toHaveTextContent('30')
    expect(split).toHaveTextContent('10')
  })

  // The milestone bar gives the counter a goal — 385 of the way to 500 must read as
  // real progress toward a named target, the hook that keeps the tab worth reopening.
  it('shows progress toward the next conversion milestone', () => {
    render(<StatsTab settings={withStats({ conversionCount: 385 })} />)
    const milestone = screen.getByTestId('stats-milestone')
    expect(milestone).toHaveTextContent('500')
    expect(milestone).toHaveTextContent('115')
  })

  // Before any activity there is nothing to celebrate, only an invitation.
  it('shows the empty state until anything has happened', () => {
    render(<StatsTab settings={withStats()} />)
    expect(screen.getByTestId('stats-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('stats-count')).toBeNull()
    expect(screen.queryByTestId('stats-imported')).toBeNull()
  })

  // Activity without conversions (listened, analyzed, matched but never converted)
  // must still show the grid — otherwise those tallies stay invisible forever.
  it('shows the grid without the conversion hero when only other activity exists', () => {
    render(<StatsTab settings={withStats({ stats: { ...zeroStats, listened: 9 } })} />)
    expect(screen.getByTestId('stats-listened')).toHaveTextContent('9')
    expect(screen.queryByTestId('stats-count')).toBeNull()
    expect(screen.queryByTestId('stats-empty')).toBeNull()
  })

  // The share card exists so the numbers can leave the app (Instagram, forums) — but
  // only once there is something to show; an all-zero card would be an empty brag.
  it('offers the share-image button only once there is activity', () => {
    render(<StatsTab settings={withStats({ conversionCount: 3 })} />)
    expect(screen.getByTestId('stats-share')).toBeInTheDocument()
    cleanup()
    render(<StatsTab settings={withStats()} />)
    expect(screen.queryByTestId('stats-share')).toBeNull()
  })

  // The support line asks for help without itemizing what the app cost to build —
  // publishing internal figures read as oversharing, so the cost/donations bars are
  // deliberately gone and only the plea plus the donate button remain.
  it('shows the support line without any cost figures', () => {
    render(<StatsTab settings={withStats()} />)
    expect(screen.getByTestId('stats-roi-donate')).toBeInTheDocument()
    expect(screen.queryByTestId('stats-roi-cost')).toBeNull()
    expect(screen.queryByTestId('stats-roi-donations')).toBeNull()
  })

  // Present even in the empty state — the plea isn't tied to this install's own
  // activity, so it must survive alongside (not depend on) stats-empty.
  it('shows the support line even with no activity yet', () => {
    render(<StatsTab settings={withStats()} />)
    expect(screen.getByTestId('stats-empty')).toBeInTheDocument()
    expect(screen.getByTestId('stats-roi-donate')).toBeInTheDocument()
  })
})
