// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../../../shared/types'
import '../i18n'
import { DONATE_URL } from '../lib/donate'
import { StatsModal } from './StatsModal'

afterEach(cleanup)

function withStats(over: Partial<Settings> = {}): Settings {
  return {
    conversionCount: 0,
    stats: {
      imported: 0,
      listened: 0,
      analyzed: 0,
      discogsMatches: 0,
      bandcampMatches: 0,
      deezerMatches: 0,
    },
    ...over,
  } as Settings
}

describe('StatsModal', () => {
  // The whole reason for the window: turn a raw tally into the "time you saved" story,
  // derived from the count, not the audio length.
  it('shows the conversion count and the estimated time saved', () => {
    render(<StatsModal settings={withStats({ conversionCount: 142 })} onClose={() => {}} />)
    expect(screen.getByTestId('stats-count')).toHaveTextContent('142')
    expect(screen.getByTestId('stats-time-saved')).toHaveTextContent('9 h 28 min')
  })

  // Before the first conversion, "0" and "0 min" would read as broken; explain the
  // value instead so the empty state still earns its place.
  it('explains the value instead of showing zeros before the first conversion', () => {
    render(<StatsModal settings={withStats()} onClose={() => {}} />)
    expect(screen.getByTestId('stats-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('stats-count')).not.toBeInTheDocument()
  })

  // Surco is free, so the place that shows the hours the app saved you is where we ask
  // for support. The link must open in the system browser (target=_blank routes through
  // the window-open handler) and exist even before the first conversion.
  it('offers a donation link in both the filled and empty states', () => {
    render(<StatsModal settings={withStats({ conversionCount: 142 })} onClose={() => {}} />)
    const donate = screen.getByTestId('stats-donate')
    expect(donate).toHaveAttribute('href', DONATE_URL)
    expect(donate).toHaveAttribute('target', '_blank')
    cleanup()

    render(<StatsModal settings={withStats()} onClose={() => {}} />)
    expect(screen.getByTestId('stats-donate')).toHaveAttribute('href', DONATE_URL)
  })

  it('names itself and closes from its own button', () => {
    const onClose = vi.fn()
    render(<StatsModal settings={withStats()} onClose={onClose} />)
    expect(screen.getByTestId('stats-modal')).toHaveAccessibleName()
    fireEvent.click(screen.getByTestId('stats-close'))
    expect(onClose).toHaveBeenCalled()
  })
})
