// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourceRail } from './SourceRail'

afterEach(cleanup)

describe('SourceRail', () => {
  it('offers the working list plus each source found on this machine', () => {
    render(<SourceRail sources={['rekordbox']} active={null} onSelect={vi.fn()} />)
    expect(screen.getByTestId('source-rail-tracks')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('source-rail-rekordbox')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByTestId('source-rail-appleMusic')).not.toBeInTheDocument()
  })

  it('picks a source, and the working list with null', () => {
    const onSelect = vi.fn()
    render(<SourceRail sources={['appleMusic', 'rekordbox']} active="rekordbox" onSelect={onSelect} />)
    fireEvent.click(screen.getByTestId('source-rail-appleMusic'))
    fireEvent.click(screen.getByTestId('source-rail-tracks'))
    expect(onSelect.mock.calls).toEqual([['appleMusic'], [null]])
  })
})
