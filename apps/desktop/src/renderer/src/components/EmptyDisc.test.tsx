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

  // It sits beside the heading that already names the state, so a screen reader that
  // announces it too would just repeat the copy.
  it('hides itself from assistive tech', () => {
    render(<EmptyDisc />)
    expect(screen.getByTestId('empty-disc')).toHaveAttribute('aria-hidden', 'true')
  })
})
