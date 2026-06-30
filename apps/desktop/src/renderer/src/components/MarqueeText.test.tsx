// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MarqueeText } from './MarqueeText'

afterEach(cleanup)

// jsdom reports 0 for layout sizes, so drive the overflow check by stubbing the measured
// widths on the elements the component reads.
function setWidths(scroll: number, client: number): void {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get() {
      return this.dataset.role === 'inner' ? scroll : client
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return client
    },
  })
}

describe('MarqueeText', () => {
  it('renders its text', () => {
    setWidths(50, 100)
    render(<MarqueeText className="x">Hard and Fast (Extended Mix)</MarqueeText>)
    expect(screen.getByText('Hard and Fast (Extended Mix)')).toBeInTheDocument()
  })

  // The scroll animation is the whole point only when the title is clipped: a title that
  // already fits must stay put, or it would drift for no reason and read as a glitch.
  it('does not arm the scroll when the text fits', () => {
    setWidths(80, 100)
    render(<MarqueeText className="x">Short</MarqueeText>)
    expect(screen.getByTestId('marquee').dataset.overflow).toBe('false')
  })

  // When the text overflows its box, the component marks itself so the hover scroll can
  // reveal the rest — the no-mouse alternative to widening the player.
  it('arms the scroll when the text overflows', () => {
    setWidths(200, 100)
    render(<MarqueeText className="x">Hard and Fast (Extended Mix)</MarqueeText>)
    expect(screen.getByTestId('marquee').dataset.overflow).toBe('true')
  })
})
