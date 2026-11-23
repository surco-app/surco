// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoudnessHelpModal } from './LoudnessHelpModal'

afterEach(cleanup)

describe('LoudnessHelpModal', () => {
  // Every metric gets the same treatment: a reader scanning for "can Surco fix this?"
  // finds the answer in the same place in each entry.
  it('gives every metric its own fixable-here answer, not just the first', () => {
    render(<LoudnessHelpModal onClose={vi.fn()} />)
    for (const m of ['lufs', 'peak', 'range', 'crest', 'balance', 'dc', 'noise']) {
      expect(screen.getByTestId(`loudness-help-fix-${m}`)).not.toBeEmptyDOMElement()
    }
  })

  // The readout tells the grades apart by shape as well as colour (round, triangle,
  // square) so a colour-blind reader can still see the verdict. The legend that explains
  // them kept three identical dots, which is the one place the shapes had to match.
  it('draws each grade in the legend with the shape the readout uses', async () => {
    const { GRADE_MARK } = await import('./LoudnessReadout')
    render(<LoudnessHelpModal onClose={vi.fn()} />)
    for (const grade of ['good', 'warn', 'bad'] as const) {
      expect(screen.getByTestId(`loudness-help-grade-${grade}`)).toHaveAttribute(
        'data-shape',
        GRADE_MARK[grade].shape,
      )
    }
  })
})
