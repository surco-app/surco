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

  // Each program's own mark is what a DJ recognises at a glance, so the rail drops the
  // words; the name stays as the button's accessible name and hover title. The marks are
  // drawn in the text colour like the list icon beside them, not in the apps' own colours,
  // so the rail reads as Surco's and the pressed state shows the same way on all three.
  it('shows each source by its own mark in the rail colour, named only for screen readers and in a tooltip', () => {
    render(<SourceRail sources={['appleMusic', 'rekordbox']} active={null} onSelect={vi.fn()} />)
    const rekordbox = screen.getByTestId('source-rail-rekordbox')
    expect(rekordbox).toHaveTextContent('')
    expect(rekordbox).toHaveAccessibleName('rekordbox')
    for (const s of ['rekordbox', 'appleMusic']) {
      const icon = screen.getByTestId(`source-rail-icon-${s}`)
      expect(icon.tagName.toLowerCase()).toBe('svg')
      expect(icon.querySelector('[fill="currentColor"]')).not.toBeNull()
    }
    expect(screen.getByTestId('source-rail-tracks')).toHaveAccessibleName('Tracks')
    expect(screen.getByTestId('source-rail-tracks')).toHaveTextContent('')
  })

  // The rail has no words, so the name a sighted user reads on hover is the only way to
  // tell the marks apart; it comes from the app's themed tooltip like every other icon.
  it('names each icon in the app tooltip on focus, not in a native title', () => {
    render(<SourceRail sources={['appleMusic', 'rekordbox']} active={null} onSelect={vi.fn()} />)
    for (const [id, name] of [
      ['tracks', 'Tracks'],
      ['rekordbox', 'rekordbox'],
    ]) {
      const button = screen.getByTestId(`source-rail-${id}`)
      expect(button).not.toHaveAttribute('title')
      fireEvent.focusIn(button)
      expect(screen.getByRole('tooltip')).toHaveTextContent(name)
      fireEvent.focusOut(button)
    }
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
