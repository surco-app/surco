// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TopProgressBar } from './TopProgressBar'

const MAXIMIZED_OVERLAY_Z = 46

function zOf(el: HTMLElement): number {
  const match = /(?:^|\s)z-\[?(\d+)\]?(?:\s|$)/.exec(el.className)
  return match ? Number(match[1]) : 0
}

describe('TopProgressBar', () => {
  it('draws under a maximized section, so the line never cuts through the full-screen editor', () => {
    render(<TopProgressBar fraction={0.5} />)
    expect(zOf(screen.getByTestId('top-progress'))).toBeLessThan(MAXIMIZED_OVERLAY_Z)
  })

  it('still sits above the toolbar content it rides on', () => {
    render(<TopProgressBar fraction={0.5} />)
    expect(zOf(screen.getByTestId('top-progress'))).toBeGreaterThan(0)
  })

  // The bar moves every time a catalog answers or a track finishes. Growing its width
  // re-lays out the toolbar on every frame of the move; scaling a full-width bar from its
  // left edge draws the same fill without touching layout.
  it('fills by scaling from the left edge, never by resizing', () => {
    render(<TopProgressBar fraction={0.6} />)
    const fill = screen.getByTestId('top-progress').firstElementChild as HTMLElement
    expect(fill.style.transform).toBe('scaleX(0.6)')
    expect(fill.style.width).toBe('')
    expect(fill.className).toContain('origin-left')
  })
})
