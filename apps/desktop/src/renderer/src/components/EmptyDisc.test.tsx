// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EmptyDisc } from './EmptyDisc'

afterEach(cleanup)

describe('EmptyDisc', () => {
  // The grooves are perfect concentric circles, so spinning them alone is literally
  // invisible: every frame looks identical. The brighter arc is the only mark that
  // betrays the rotation, which makes it load-bearing rather than decoration.
  it('carries an off-centre groove mark so the rotation can be seen at all', () => {
    render(<EmptyDisc />)
    expect(screen.getByTestId('empty-disc-mark')).toBeInTheDocument()
  })

  // Only the platter turns. The label holds the waveform, and a spinning waveform would
  // read as a loading spinner — the one thing an idle empty state must not claim.
  it('spins the platter and leaves the label still', () => {
    render(<EmptyDisc />)
    expect(screen.getByTestId('empty-disc-platter')).toHaveClass('empty-disc-spin')
    expect(screen.getByTestId('empty-disc-label')).not.toHaveClass('empty-disc-spin')
  })

  // It sits beside the heading that already names the state, so a screen reader that
  // announces it too would just repeat the copy.
  it('hides itself from assistive tech', () => {
    render(<EmptyDisc />)
    expect(screen.getByTestId('empty-disc')).toHaveAttribute('aria-hidden', 'true')
  })
})
