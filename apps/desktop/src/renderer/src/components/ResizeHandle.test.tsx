// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResizeHandle } from './ResizeHandle'

afterEach(cleanup)

// A tooltip advertises a gesture. When the panel has nothing to fit to (an empty list),
// the caller drops the title so the divider never promises a double-click that can't do
// anything — the hover hint appears only when a title is actually passed.
describe('ResizeHandle', () => {
  it('shows no hover tooltip when no title is given', () => {
    vi.useFakeTimers()
    render(<ResizeHandle onPointerDown={vi.fn()} />)
    const handle = screen.getByRole('separator')
    fireEvent.pointerEnter(handle)
    fireEvent.pointerMove(handle, { clientX: 10, clientY: 10 })
    act(() => vi.advanceTimersByTime(500))
    expect(screen.queryByRole('tooltip')).toBeNull()
    vi.useRealTimers()
  })

  it('shows the hover tooltip when a title is given', () => {
    vi.useFakeTimers()
    render(<ResizeHandle onPointerDown={vi.fn()} title="Fit to content" />)
    const handle = screen.getByRole('separator')
    fireEvent.pointerEnter(handle)
    fireEvent.pointerMove(handle, { clientX: 10, clientY: 10 })
    act(() => vi.advanceTimersByTime(500))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Fit to content')
    vi.useRealTimers()
  })
})
