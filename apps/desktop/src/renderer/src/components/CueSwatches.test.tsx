// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import '../i18n'
import { CueSwatches } from './CueSwatches'

afterEach(cleanup)

describe('CueSwatches', () => {
  it('says when the track is not analysed or has no cues', () => {
    render(<CueSwatches summary={{ analysed: false, hot: [] }} pending={false} />)
    expect(screen.getByTestId('track-cue-swatches')).toHaveTextContent('not analysed')
    cleanup()
    render(<CueSwatches summary={{ analysed: true, hot: [] }} pending={false} />)
    expect(screen.getByTestId('track-cue-swatches')).toHaveTextContent('no cues')
  })

  it('draws one square per hot cue, hollow while waiting for rekordbox', () => {
    render(
      <CueSwatches
        summary={{
          analysed: true,
          hot: [
            { ms: 1000, color: 1 },
            { ms: 2000, color: 42 },
          ],
        }}
        pending
      />,
    )
    expect(screen.getAllByTestId('track-cue-swatch')).toHaveLength(2)
    expect(screen.getByTestId('track-cue-swatches')).toHaveAttribute('data-pending', 'true')
  })

  it('shows a hollow marker for cues waiting in the queue when the track has none yet', () => {
    render(<CueSwatches summary={{ analysed: true, hot: [] }} pending />)
    expect(screen.getByTestId('track-cue-pending')).toBeInTheDocument()
    expect(screen.getByTestId('track-cue-swatches')).not.toHaveTextContent('no cues')
    expect(screen.getByTestId('track-cue-swatches')).toHaveAttribute(
      'aria-label',
      'Cues waiting for rekordbox',
    )
  })

  it('fills a cue colour outside the known palette in a neutral colour, never like a pending outline', () => {
    render(
      <CueSwatches summary={{ analysed: true, hot: [{ ms: 1000, color: 5 }] }} pending={false} />,
    )
    expect(screen.getByTestId('track-cue-swatch').style.backgroundColor).toBe(
      'var(--color-fg-faint)',
    )
  })

  it('names the count of cues and whether they wait, for screen readers', () => {
    const hot = [
      { ms: 1000, color: 1 },
      { ms: 1000, color: 22 },
    ]
    render(<CueSwatches summary={{ analysed: true, hot }} pending={false} />)
    expect(screen.getByTestId('track-cue-swatches')).toHaveAttribute('aria-label', '2 hot cues')
    expect(screen.getAllByTestId('track-cue-swatch')).toHaveLength(2)
    cleanup()
    render(<CueSwatches summary={{ analysed: true, hot: hot.slice(0, 1) }} pending />)
    expect(screen.getByTestId('track-cue-swatches')).toHaveAttribute(
      'aria-label',
      '1 hot cue waiting for rekordbox',
    )
  })
})
