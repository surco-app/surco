// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CuePalette } from './CuePalette'

afterEach(cleanup)

describe('CuePalette', () => {
  it('offers rekordbox 16 colours and marks the current one', () => {
    const onPick = vi.fn()
    render(<CuePalette value={22} onPick={onPick} label={(i) => `Color ${i}`} />)
    expect(screen.getAllByRole('button')).toHaveLength(16)
    expect(screen.getByTestId('cue-palette-22')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTestId('cue-palette-42'))
    expect(onPick).toHaveBeenCalledWith(42)
  })
})
