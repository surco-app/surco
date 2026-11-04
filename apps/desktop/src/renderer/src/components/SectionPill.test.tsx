// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SectionPill } from './SectionPill'

afterEach(cleanup)

describe('SectionPill', () => {
  // The dot alone left the Quality header as the one folded header with no words, beside
  // Trim's "3.6 s from the end" and Vinyl repair's "~19 clicks": reading down the editor,
  // a good track's verdict was the only one that had to be decoded from a colour.
  it('shows a good status in words beside its dot, like every other header summary', () => {
    render(
      <SectionPill tone="good" testid="pill">
        Good quality
      </SectionPill>,
    )
    expect(screen.getByText('Good quality')).not.toHaveClass('sr-only')
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
