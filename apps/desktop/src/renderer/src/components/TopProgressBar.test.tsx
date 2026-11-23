// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LAYER } from '../lib/layers'
import { TopProgressBar } from './TopProgressBar'

function zOf(el: HTMLElement): number {
  return Number(el.style.zIndex)
}

describe('TopProgressBar', () => {
  it('draws under a maximized section, so the line never cuts through the full-screen editor', () => {
    render(<TopProgressBar fraction={0.5} />)
    expect(zOf(screen.getByTestId('top-progress'))).toBeLessThan(LAYER.maximizedSection)
  })

  it('still sits above the toolbar content it rides on', () => {
    render(<TopProgressBar fraction={0.5} />)
    expect(zOf(screen.getByTestId('top-progress'))).toBeGreaterThan(0)
  })

  it('fills by scaling from the left edge, never by resizing', () => {
    render(<TopProgressBar fraction={0.6} />)
    const fill = screen.getByTestId('top-progress').firstElementChild as HTMLElement
    expect(fill.style.transform).toBe('scaleX(0.6)')
    expect(fill.style.width).toBe('')
  })
})
