// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { ViewMenu } from './ViewMenu'

afterEach(cleanup)

describe('ViewMenu', () => {
  it('keeps itself inside the window when opened at the bottom right corner', () => {
    const size = { width: window.innerWidth, height: window.innerHeight }
    Object.assign(window, { innerWidth: 800, innerHeight: 600 })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.dataset.testid !== 'view-menu') return new DOMRect(0, 0, 0, 0)
      return new DOMRect(0, 0, 180, 120)
    })
    try {
      render(
        <ViewMenu
          x={780}
          y={590}
          label="View"
          items={[{ id: 'sidebar', label: 'Sidebar', checked: true, onToggle: () => {} }]}
          onClose={() => {}}
        />,
      )
      const menu = screen.getByTestId('view-menu')
      expect(menu.style.left).toBe('612px')
      expect(menu.style.top).toBe('472px')
    } finally {
      vi.restoreAllMocks()
      Object.assign(window, { innerWidth: size.width, innerHeight: size.height })
    }
  })

  function renderMenu(onClose = vi.fn()) {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    render(
      <ViewMenu
        x={10}
        y={10}
        label="View"
        items={['sidebar', 'player', 'cues'].map((id) => ({
          id,
          label: id,
          checked: false,
          onToggle: () => {},
        }))}
        onClose={onClose}
      />,
    )
    return { opener, onClose, menu: screen.getByTestId('view-menu') }
  }

  // Opened from the keyboard, the menu took the focus but only its first item could ever be
  // reached; the arrows walk it like every other menu, wrapping at the ends, and stay here
  // instead of stepping the track list behind it.
  it('walks its items with the arrows, Home and End, wrapping at the ends', () => {
    const { menu, opener } = renderMenu()
    const seen = vi.fn()
    window.addEventListener('keydown', seen)
    expect(screen.getByTestId('view-menu-sidebar')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByTestId('view-menu-player')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'End' })
    expect(screen.getByTestId('view-menu-cues')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByTestId('view-menu-sidebar')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(screen.getByTestId('view-menu-cues')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(screen.getByTestId('view-menu-sidebar')).toHaveFocus()
    window.removeEventListener('keydown', seen)
    expect(seen).not.toHaveBeenCalled()
    opener.remove()
  })

  // Opened over the content, the menu has no place in the Tab order: Tab and Shift+Tab
  // close it without moving on, and the focus goes back to where it was opened.
  it.each([
    ['Tab', false],
    ['Shift+Tab', true],
  ])('closes on %s without moving on', (_name, shiftKey) => {
    const { menu, onClose, opener } = renderMenu()
    const carriedOn = fireEvent.keyDown(menu, { key: 'Tab', shiftKey })
    expect(carriedOn).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
    opener.remove()
  })
})
