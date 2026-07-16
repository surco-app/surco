// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TrimSkeleton } from './TrimSkeleton'

afterEach(cleanup)

describe('TrimSkeleton', () => {
  // Silence Trim is a two-lane view (START | END), each with a control row over a wave.
  // The placeholder must carry the same shape so the real lanes swap in without a jump —
  // the single-block skeleton it replaces looked nothing like the split it stood for.
  it('renders two lanes, each a height-pinned wave placeholder', () => {
    render(<TrimSkeleton />)
    expect(screen.getByTestId('trim-skeleton').className).toContain('gap-8')
    const start = screen.getByTestId('trim-loading-start')
    const end = screen.getByTestId('trim-loading-end')
    for (const s of [start, end]) {
      // The wave sits in a positioned, fixed-height box — the guard against the
      // full-window-wave bug the real lane also relies on.
      expect(s.parentElement?.className).toContain('relative')
      expect(s.parentElement?.className).toContain('h-24')
    }
  })
})
