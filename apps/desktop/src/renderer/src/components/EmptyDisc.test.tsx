// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EmptyDisc } from './EmptyDisc'

afterEach(cleanup)

describe('EmptyDisc', () => {
  // The rings are the whole animation: the disc itself never moves, so if they were
  // dropped the empty state would go completely still.
  it('carries the rings that pulse out of the disc', () => {
    render(<EmptyDisc />)
    expect(screen.getAllByTestId('empty-disc-ring')).toHaveLength(3)
  })

  // Each ring leaves a beat after the last one. Sharing a delay would stack all three
  // into a single thicker ring and the pulse would read as one blink, not as a rhythm.
  it('staggers the rings so they leave one after another', () => {
    render(<EmptyDisc />)
    const delays = screen.getAllByTestId('empty-disc-ring').map((ring) => ring.style.animationDelay)
    expect(new Set(delays).size).toBe(3)
  })

  // The disc stays put. A turning platter reads as a progress indicator, which is the
  // one thing an idle empty state must not claim — that was the old disc's failing.
  it('leaves the disc itself still', () => {
    render(<EmptyDisc />)
    expect(screen.getByTestId('empty-disc-platter')).not.toHaveClass('empty-disc-ping')
    expect(screen.getByTestId('empty-disc-label')).not.toHaveClass('empty-disc-ping')
  })

  // It sits beside the heading that already names the state, so a screen reader that
  // announces it too would just repeat the copy.
  it('hides itself from assistive tech', () => {
    render(<EmptyDisc />)
    expect(screen.getByTestId('empty-disc')).toHaveAttribute('aria-hidden', 'true')
  })

  // The entrance scales the whole svg; the ping scales each ring inside it. Both on one
  // element would mean two animations writing transform, and the entrance — declared
  // second — would win and freeze the pulse for its duration.
  it('keeps the entrance off the elements that pulse', () => {
    render(<EmptyDisc />)
    const svg = screen.getByTestId('empty-disc')
    expect(svg).toHaveClass('empty-disc-in')
    expect(svg).not.toHaveClass('empty-disc-ping')
    for (const ring of screen.getAllByTestId('empty-disc-ring')) {
      expect(ring).not.toHaveClass('empty-disc-in')
    }
  })
})
