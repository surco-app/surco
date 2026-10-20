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
})
