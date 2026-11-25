// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useSplitMenu } from './SplitButton'

afterEach(cleanup)

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
          <div ref={menuRef} role="menu" data-testid="menu" onKeyDown={onMenuKeyDown}>
            <button type="button" role="menuitemradio" aria-checked="true" data-testid="mp3">
              MP3
            </button>
            <button type="button" role="menuitem" aria-disabled="true" data-testid="again">
              Again
            </button>
            <button type="button" role="menuitemradio" aria-checked="false" data-testid="flac">
              FLAC
            </button>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked="false"
              disabled
              data-testid="music"
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
  // Apple Music under FLAC and a blocked convert can't be picked: parked on either, Enter
  // does nothing and the keyboard user is left in a menu that stopped answering.
  it('steps the arrows, Home and End over items disabled natively or with aria-disabled', () => {
    const menu = openMenu()
    expect(screen.getByTestId('mp3')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByTestId('flac')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByTestId('mp3')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(screen.getByTestId('flac')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(screen.getByTestId('mp3')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'End' })
    expect(screen.getByTestId('flac')).toHaveFocus()
  })
})
