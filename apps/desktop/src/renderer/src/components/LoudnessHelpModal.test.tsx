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

  // The help used to say Surco never removes noise, while vinyl repair's background noise
  // control lowers exactly the hiss this floor measures. A reader with a noisy rip gave up
  // on a fix the app offers, so every language must point at that control by its name.
  it('points the noise floor at vinyl repair in every language', async () => {
    const locales = import.meta.glob<{
      editor: { loudnessFixNoise: string }
      declick: { title: string; noiseLabel: string }
    }>('../i18n/locales/*.json', { eager: true, import: 'default' })
    for (const [file, t] of Object.entries(locales)) {
      expect(t.editor.loudnessFixNoise, file).toContain(t.declick.noiseLabel)
      expect(t.editor.loudnessFixNoise, file).toContain(t.declick.title)
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
