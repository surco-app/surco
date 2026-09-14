// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PathField } from './PathField'

afterEach(cleanup)

describe('PathField', () => {
  it('shows the path and asks the caller to change it', () => {
    const onChange = vi.fn()
    render(<PathField value="/dj/master.db" onChange={onChange} testid="f" />)

    expect(screen.getByTestId('f')).toHaveTextContent('/dj/master.db')
    fireEvent.click(screen.getByTestId('f-change'))
    expect(onChange).toHaveBeenCalled()
  })

  // The path is often wider than the panel, and the panel's width is the user's own. The
  // whole value stays reachable as a tooltip rather than being lost to the truncation.
  it('carries the whole path for reading even when it is truncated', () => {
    render(<PathField value="/very/long/path/master.db" onChange={vi.fn()} testid="f" />)

    expect(screen.getByTestId('f')).toHaveAttribute('title', '/very/long/path/master.db')
  })

  // An empty box says nothing about what it wants. Reported 14/09 alongside the request to
  // join the two halves: the Traktor field sat blank with the button floating beside it.
  it('says what it needs when no path is set', () => {
    render(<PathField value="" onChange={vi.fn()} testid="f" emptyLabel="Sin elegir" />)

    expect(screen.getByTestId('f')).toHaveTextContent('Sin elegir')
  })

  // Nothing can be typed here — the value only ever comes from the picker. As a real input
  // it took a caret and scrolled the text sideways on click, hiding the start of the path.
  it('is not a text input', () => {
    render(<PathField value="/dj/master.db" onChange={vi.fn()} testid="f" />)

    expect(screen.getByTestId('f').tagName).not.toBe('INPUT')
  })
})
