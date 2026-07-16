// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The menu reads window.api.platform at render, so stub it before importing.
vi.hoisted(() => {
  ;(globalThis.window as unknown as { api: unknown }).api = { platform: 'darwin' }
})

import '../i18n'
import type { TrackItem } from '../types'
import { TrackContextMenu } from './TrackContextMenu'

afterEach(cleanup)

const track = {
  id: 't1',
  inputPath: '/m/t1.wav',
  fileName: 't1.wav',
  listLabel: 't1',
  query: '',
  status: 'idle',
  meta: {},
} as unknown as TrackItem

function renderMenu(over: Record<string, unknown> = {}) {
  const props = {
    track,
    x: 0,
    y: 0,
    onClose: vi.fn(),
    onSearch: vi.fn(),
    onSearchWeb: vi.fn(),
    onStartOver: vi.fn(),
    onCopyMeta: vi.fn(),
    onCopyPath: vi.fn(),
    onPasteMeta: vi.fn(),
    canPasteMeta: false,
    onRemove: vi.fn(),
    onTrash: vi.fn(),
    ...over,
  }
  render(<TrackContextMenu {...props} />)
  return props
}

describe('TrackContextMenu order', () => {
  // Items are ordered by workflow priority: metadata work (the app's core loop) first,
  // file utilities second, destructive actions last — not by how the OS groups file ops.
  it('lists metadata actions first, file utilities second, destructive actions last', () => {
    renderMenu({ canPasteMeta: true })
    const ids = screen
      .getAllByRole('menuitem')
      .map((el) => el.getAttribute('data-testid'))
      .filter((id) => id !== 'track-menu-backdrop')
    expect(ids).toEqual([
      'track-menu-search',
      'track-menu-search-web',
      'track-menu-copy-meta',
      'track-menu-paste-meta',
      'track-menu-startover',
      'track-menu-reveal',
      'track-menu-open',
      'track-menu-copy',
      'track-menu-remove',
      'track-menu-trash',
    ])
  })
})

describe('TrackContextMenu keyboard', () => {
  // The menu can be opened from the keyboard (Shift+F10 / the context-menu key), so
  // focus must move into it or a keyboard user is stranded with no way to pick an item.
  it('focuses the first item on open', () => {
    renderMenu()
    expect(screen.getByTestId('track-menu-search')).toHaveFocus()
  })

  // The open menu owns its keys. Any that leak to the window-level shortcut handler
  // move the track selection behind the menu (remounting the editor) or toggle the
  // player when Space was meant to activate the focused item.
  it('keeps its keys from reaching window-level shortcut handlers', () => {
    renderMenu()
    const seen = vi.fn()
    window.addEventListener('keydown', seen)
    const menu = screen.getByTestId('track-menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    fireEvent.keyDown(menu, { key: 'Enter' })
    fireEvent.keyDown(menu, { key: ' ' })
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(seen).not.toHaveBeenCalled()
    window.removeEventListener('keydown', seen)
  })

  it('moves focus between items with the arrow keys, wrapping at the ends', () => {
    renderMenu()
    const menu = screen.getByTestId('track-menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByTestId('track-menu-search-web')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(screen.getByTestId('track-menu-search')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(screen.getByTestId('track-menu-trash')).toHaveFocus()
  })

  it('returns focus to the element that opened it when it closes', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    renderMenu()
    expect(opener).not.toHaveFocus()
    cleanup()
    expect(opener).toHaveFocus()
    opener.remove()
  })
})

describe('TrackContextMenu search web', () => {
  // Delegated to App (not a window.open here) so the query is built from the same
  // Settings file-name pattern the ⌘K "Search on Google" command uses.
  it('delegates the Google search to App with the track, then closes', () => {
    const onSearchWeb = vi.fn()
    const onClose = vi.fn()
    const props = renderMenu({ onSearchWeb, onClose })
    fireEvent.click(screen.getByTestId('track-menu-search-web'))
    expect(onSearchWeb).toHaveBeenCalledWith(props.track)
    expect(onClose).toHaveBeenCalled()
  })
})

describe('TrackContextMenu copy path', () => {
  // Copy path is delegated to App (not fired at window.api here) so App can confirm the
  // copy with a toast — the same feedback the other copies give.
  it('delegates copy path to App with the track, then closes', () => {
    const onCopyPath = vi.fn()
    const onClose = vi.fn()
    const props = renderMenu({ onCopyPath, onClose })
    fireEvent.click(screen.getByTestId('track-menu-copy'))
    expect(onCopyPath).toHaveBeenCalledWith(props.track)
    expect(onClose).toHaveBeenCalled()
  })
})
