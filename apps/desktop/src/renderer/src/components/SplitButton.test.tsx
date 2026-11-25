// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ignoreDisabledClick } from '../lib/menuStep'
import { useSplitMenu } from './SplitButton'

afterEach(cleanup)

const picked = vi.fn<(id: string) => void>()

function Harness(): React.JSX.Element {
  const { open, setOpen, ref, toggleRef, menuRef, onMenuKeyDown } = useSplitMenu()
  return (
    <>
      <button type="button" data-testid="before">
        before
      </button>
      <div ref={ref}>
        <button
          type="button"
          data-testid="toggle"
          ref={toggleRef}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        />
        {open && (
          <div
            ref={menuRef}
            role="menu"
            data-testid="menu"
            onKeyDown={onMenuKeyDown}
            onClickCapture={ignoreDisabledClick}
          >
            <button type="button" role="menuitemradio" aria-checked="true" data-testid="mp3">
              MP3
            </button>
            <button
              type="button"
              role="menuitem"
              aria-disabled="true"
              data-testid="again"
              onClick={() => picked('again')}
            >
              <span data-testid="again-label">Again</span>
            </button>
            <button type="button" role="menuitemradio" aria-checked="false" data-testid="flac">
              FLAC
            </button>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked="false"
              aria-disabled="true"
              data-testid="music"
              onClick={() => picked('music')}
            >
              Apple Music
            </button>
          </div>
        )}
      </div>
      <button type="button" data-testid="after">
        after
      </button>
    </>
  )
}

function openMenu(): HTMLElement {
  render(<Harness />)
  fireEvent.click(screen.getByTestId('toggle'))
  return screen.getByTestId('menu')
}

describe('useSplitMenu disabled items', () => {
  // Apple Music under FLAC and a blocked convert can't be picked, but like a macOS menu the
  // arrows stop on them, so the keyboard user finds them and hears why; picking one, by
  // Enter or by a click on the item or on what it holds, does nothing and leaves the menu open.
  it('stops the arrows, Home and End on disabled items, which do nothing when picked', () => {
    picked.mockClear()
    const menu = openMenu()
    expect(screen.getByTestId('mp3')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByTestId('again')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByTestId('flac')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByTestId('music')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByTestId('mp3')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(screen.getByTestId('music')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(screen.getByTestId('mp3')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'End' })
    expect(screen.getByTestId('music')).toHaveFocus()
    fireEvent.click(screen.getByTestId('music'))
    fireEvent.click(screen.getByTestId('again-label'))
    expect(picked).not.toHaveBeenCalled()
    expect(screen.getByTestId('menu')).toBeInTheDocument()
  })
})

describe('useSplitMenu Tab', () => {
  // Tab means "next control", not "stay in this menu": the menu closes and the browser's
  // own Tab carries on from the chevron that opened it, so the keyboard user lands on the
  // control beside it instead of wherever the menu happens to sit in the page.
  it.each([
    ['Tab', false],
    ['Shift+Tab', true],
  ])('closes on %s and lets the move go on from the chevron', (_name, shiftKey) => {
    openMenu()
    const carriedOn = fireEvent.keyDown(screen.getByTestId('flac'), { key: 'Tab', shiftKey })
    expect(carriedOn).toBe(true)
    expect(screen.queryByTestId('menu')).toBeNull()
    expect(screen.getByTestId('toggle')).toHaveFocus()
  })
})
