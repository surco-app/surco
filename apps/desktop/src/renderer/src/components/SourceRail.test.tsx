// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { SourceRail } from './SourceRail'

afterEach(cleanup)

describe('SourceRail', () => {
  it('offers the working list plus each source found on this machine', () => {
    render(<SourceRail onHide={vi.fn()} sources={['rekordbox']} active={null} onSelect={vi.fn()} />)
    expect(screen.getByTestId('source-rail-tracks')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('source-rail-rekordbox')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByTestId('source-rail-appleMusic')).not.toBeInTheDocument()
  })

  // Each program's own mark is what a DJ recognises at a glance, so the rail drops the
  // words; the name stays as the button's accessible name and hover title. The marks are
  // drawn in the text colour like the list icon beside them, not in the apps' own colours,
  // so the rail reads as Surco's and the pressed state shows the same way on all three.
  it('shows each source by its own mark in the rail colour, named only for screen readers and in a tooltip', () => {
    render(
      <SourceRail
        onHide={vi.fn()}
        sources={['appleMusic', 'rekordbox']}
        active={null}
        onSelect={vi.fn()}
      />,
    )
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
    render(
      <SourceRail
        onHide={vi.fn()}
        sources={['appleMusic', 'rekordbox']}
        active={null}
        onSelect={vi.fn()}
      />,
    )
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
      <SourceRail
        onHide={vi.fn()}
        sources={['appleMusic', 'rekordbox']}
        active="rekordbox"
        onSelect={onSelect}
      />,
    )
    fireEvent.click(screen.getByTestId('source-rail-appleMusic'))
    fireEvent.click(screen.getByTestId('source-rail-tracks'))
    expect(onSelect.mock.calls).toEqual([['appleMusic'], [null]])
  })

  describe('hiding a source', () => {
    function setup(active: 'appleMusic' | 'rekordbox' | null = null) {
      const onSelect = vi.fn<(source: 'appleMusic' | 'rekordbox' | null) => void>()
      const onHide = vi.fn<(source: 'appleMusic' | 'rekordbox') => void>()
      render(
        <SourceRail
          sources={['appleMusic', 'rekordbox']}
          active={active}
          onSelect={onSelect}
          onHide={onHide}
        />,
      )
      return { onSelect, onHide }
    }

    it('offers to hide a source from its right-click menu, named after it', () => {
      setup()
      fireEvent.contextMenu(screen.getByTestId('source-rail-rekordbox'))
      expect(screen.getByRole('menu')).toBeInTheDocument()
      expect(screen.getByTestId('source-rail-hide')).toHaveTextContent('Hide rekordbox')
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
      fireEvent.contextMenu(screen.getByTestId('source-rail-appleMusic'))
      expect(screen.getByTestId('source-rail-hide')).toHaveTextContent('Hide Apple Music')
    })

    it('hides the source it was opened on and leaves the open one alone', () => {
      const { onHide, onSelect } = setup('appleMusic')
      fireEvent.contextMenu(screen.getByTestId('source-rail-rekordbox'))
      fireEvent.click(screen.getByTestId('source-rail-hide'))
      expect(onHide.mock.calls).toEqual([['rekordbox']])
      expect(onSelect).not.toHaveBeenCalled()
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('goes back to the working list first when the source being hidden is the open one', () => {
      const { onHide, onSelect } = setup('rekordbox')
      fireEvent.contextMenu(screen.getByTestId('source-rail-rekordbox'))
      fireEvent.click(screen.getByTestId('source-rail-hide'))
      expect(onSelect.mock.calls).toEqual([[null]])
      expect(onHide.mock.calls).toEqual([['rekordbox']])
    })

    it('has no menu on the working list, which cannot be hidden', () => {
      setup()
      fireEvent.contextMenu(screen.getByTestId('source-rail-tracks'))
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('closes with Escape or a click outside and hides nothing', () => {
      const { onHide } = setup()
      fireEvent.contextMenu(screen.getByTestId('source-rail-rekordbox'))
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      fireEvent.contextMenu(screen.getByTestId('source-rail-rekordbox'))
      fireEvent.click(screen.getByTestId('source-rail-menu-backdrop'))
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(onHide).not.toHaveBeenCalled()
    })

    it('opens from the keyboard with Shift+F10 or the context-menu key, on the focused source, and takes the focus', () => {
      setup()
      const button = screen.getByTestId('source-rail-rekordbox')
      button.focus()
      fireEvent.keyDown(button, { key: 'F10', shiftKey: true })
      expect(screen.getByTestId('source-rail-hide')).toHaveFocus()
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
      expect(button).toHaveFocus()
      fireEvent.keyDown(button, { key: 'ContextMenu' })
      expect(screen.getByRole('menu')).toBeInTheDocument()
    })
  })
})
