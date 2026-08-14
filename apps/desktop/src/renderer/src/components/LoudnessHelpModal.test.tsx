// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoudnessHelpModal } from './LoudnessHelpModal'

afterEach(cleanup)

describe('LoudnessHelpModal', () => {
  // A user reading the explainer has two separate questions per metric: what the figure
  // means, and whether Surco can do anything about it. Run together in one paragraph the
  // second answer disappears into the prose — the reader asked for it on its own line.
  it('sets the fixable-here answer on its own line, apart from the description', () => {
    render(<LoudnessHelpModal onClose={vi.fn()} />)
    const fix = screen.getByTestId('loudness-help-fix-lufs')
    expect(fix).toBeInTheDocument()
    // A block-level element starts a new line where an inline span would have flowed on
    // from the range sentence.
    expect(fix.className).toContain('block')
  })

  // Every metric gets the same treatment: a reader scanning for "can Surco fix this?"
  // finds the answer in the same place in each entry.
  it('splits the answer out for every metric, not just the first', () => {
    render(<LoudnessHelpModal onClose={vi.fn()} />)
    for (const m of ['lufs', 'peak', 'range', 'crest', 'balance', 'dc', 'noise']) {
      expect(screen.getByTestId(`loudness-help-fix-${m}`).className).toContain('block')
    }
  })
})
