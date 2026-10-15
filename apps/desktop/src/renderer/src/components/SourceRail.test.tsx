// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { SourceRail } from './SourceRail'

afterEach(cleanup)

describe('SourceRail', () => {
  it('offers the working list plus each source found on this machine', () => {
    render(<SourceRail sources={['rekordbox']} active={null} onSelect={vi.fn()} />)
    expect(screen.getByTestId('source-rail-tracks')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('source-rail-rekordbox')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByTestId('source-rail-appleMusic')).not.toBeInTheDocument()
  })

  // Each program's own icon is what a DJ recognises at a glance, so the rail drops the
  // words; the name stays as the button's accessible name and hover title.
  it('shows each source by its own icon, naming it only for screen readers and on hover', () => {
    render(<SourceRail sources={['appleMusic', 'rekordbox']} active={null} onSelect={vi.fn()} />)
    const rekordbox = screen.getByTestId('source-rail-rekordbox')
    expect(rekordbox).toHaveTextContent('')
    expect(rekordbox).toHaveAccessibleName('rekordbox')
    expect(rekordbox).toHaveAttribute('title', 'rekordbox')
    expect(screen.getByTestId('source-rail-icon-rekordbox').getAttribute('src')).toMatch(
      /rekordbox/,
    )
    expect(screen.getByTestId('source-rail-icon-appleMusic').getAttribute('src')).toMatch(
      /apple-music/,
    )
    expect(screen.getByTestId('source-rail-tracks')).toHaveAccessibleName('Tracks')
    expect(screen.getByTestId('source-rail-tracks')).toHaveTextContent('')
  })

  it('picks a source, and the working list with null', () => {
    const onSelect = vi.fn()
    render(
      <SourceRail sources={['appleMusic', 'rekordbox']} active="rekordbox" onSelect={onSelect} />,
    )
    fireEvent.click(screen.getByTestId('source-rail-appleMusic'))
    fireEvent.click(screen.getByTestId('source-rail-tracks'))
    expect(onSelect.mock.calls).toEqual([['appleMusic'], [null]])
  })
})
