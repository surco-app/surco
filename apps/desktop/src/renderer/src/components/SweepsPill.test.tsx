// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SweepsPill } from './SweepsPill'
import { TopProgressBar } from './TopProgressBar'

afterEach(cleanup)

function zOf(el: HTMLElement): number {
  const match = /(?:^|\s)z-\[?(\d+)\]?(?:\s|$)/.exec(el.className)
  return match ? Number(match[1]) : 0
}

describe('SweepsPill', () => {
  it('opens its menu above the progress lines, so no line cuts through the rows the user is reading', () => {
    render(
      <>
        <TopProgressBar fraction={0.5} />
        <SweepsPill
          tasks={[{ kind: 'analyze', done: 1, total: 4 }]}
          slowed={false}
          onStop={{ import: vi.fn(), analyze: vi.fn(), match: vi.fn() }}
        />
      </>,
    )
    fireEvent.click(screen.getByTestId('sweeps-pill'))
    expect(zOf(screen.getByTestId('sweeps-menu'))).toBeGreaterThan(
      zOf(screen.getByTestId('top-progress')),
    )
  })
})
