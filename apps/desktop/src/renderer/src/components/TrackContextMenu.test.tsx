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
    onStartOver: vi.fn(),
    onRemove: vi.fn(),
    onTrash: vi.fn(),
    ...over,
  }
  render(<TrackContextMenu {...props} />)
  return props
}

describe('TrackContextMenu keyboard', () => {
  // The menu can be opened from the keyboard (Shift+F10 / the context-menu key), so
  // focus must move into it or a keyboard user is stranded with no way to pick an item.
  it('focuses the first item on open', () => {
    renderMenu()
    expect(screen.getByTestId('track-menu-reveal')).toHaveFocus()
  })

  it('moves focus between items with the arrow keys, wrapping at the ends', () => {
    renderMenu()
    const menu = screen.getByTestId('track-menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByTestId('track-menu-open')).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(screen.getByTestId('track-menu-reveal')).toHaveFocus()
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
