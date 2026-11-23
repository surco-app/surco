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
  it('renders a START and an END lane placeholder', () => {
    render(<TrimSkeleton />)
    expect(screen.getByTestId('trim-skeleton')).toBeInTheDocument()
    expect(screen.getByTestId('trim-loading-start')).toBeInTheDocument()
    expect(screen.getByTestId('trim-loading-end')).toBeInTheDocument()
  })
})
