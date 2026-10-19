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
})
