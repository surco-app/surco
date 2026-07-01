// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Confetti } from './Confetti'

afterEach(cleanup)

function stubReducedMotion(reduced: boolean): void {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: reduced,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia
}

describe('Confetti', () => {
  // The burst is pure celebration, so a user who asked the OS to cut animation must get
  // nothing at all — no canvas to paint, no rAF loop running behind the modal.
  it('renders nothing when the user prefers reduced motion', () => {
    stubReducedMotion(true)
    render(<Confetti />)
    expect(screen.queryByTestId('confetti')).not.toBeInTheDocument()
  })

  it('renders a pointer-transparent overlay canvas when motion is allowed', () => {
    stubReducedMotion(false)
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null)
    render(<Confetti />)
    const canvas = screen.getByTestId('confetti')
    expect(canvas).toBeInTheDocument()
    // It must never swallow clicks meant for the dialog underneath it.
    expect(canvas).toHaveClass('pointer-events-none')
  })
})
