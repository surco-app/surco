// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Settings } from '../../../../shared/types'
import '../../i18n'
import { StatsTab } from './StatsTab'

afterEach(cleanup)

const zeroStats = { imported: 0, listened: 0, analyzed: 0, discogsMatches: 0, bandcampMatches: 0 }

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
          },
        })}
      />,
    )
    expect(screen.getByTestId('stats-imported')).toHaveTextContent('812')
    expect(screen.getByTestId('stats-listened')).toHaveTextContent('240')
    expect(screen.getByTestId('stats-analyzed')).toHaveTextContent('512')
    expect(screen.getByTestId('stats-discogsMatches')).toHaveTextContent('301')
    expect(screen.getByTestId('stats-bandcampMatches')).toHaveTextContent('17')
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

  // ROI shows what Surco cost to build against what it has received in donations —
  // the ask in "donate" becomes a concrete progress bar instead of an abstract plea.
  it('shows cost and donations progress bars', () => {
    render(<StatsTab settings={withStats()} />)
    expect(screen.getByTestId('stats-roi-cost')).toHaveTextContent('3200')
    expect(screen.getByTestId('stats-roi-donations')).toHaveTextContent('0')
    expect(screen.getByTestId('stats-roi-donate')).toBeInTheDocument()
  })

  // Present even in the empty state — ROI isn't tied to this install's own activity,
  // it's project-wide, so it must survive alongside (not depend on) stats-empty.
  it('shows the ROI section even with no activity yet', () => {
    render(<StatsTab settings={withStats()} />)
    expect(screen.getByTestId('stats-empty')).toBeInTheDocument()
    expect(screen.getByTestId('stats-roi-cost')).toBeInTheDocument()
  })
})
