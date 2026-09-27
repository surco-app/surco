// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SectionPill } from './SectionPill'

afterEach(cleanup)

describe('SectionPill', () => {
  // Green means "nothing to do here", so the dot says it alone: "Good quality" and "In
  // library" beside it repeated the colour in words. The words stay for a screen reader.
  it('shows a good status as its dot alone and keeps the words for assistive tech', () => {
    render(
      <SectionPill tone="good" testid="pill">
        Good quality
      </SectionPill>,
    )
    expect(screen.getByTestId('pill')).toHaveTextContent('Good quality')
    expect(screen.getByText('Good quality')).toHaveClass('sr-only')
  })

  // A status that asks for a look has to read before the eye finds the dot.
  it('keeps the words visible when the status wants attention', () => {
    render(
      <SectionPill tone="warn" testid="pill">
        Review
      </SectionPill>,
    )
    expect(screen.getByText('Review')).not.toHaveClass('sr-only')
  })
})
