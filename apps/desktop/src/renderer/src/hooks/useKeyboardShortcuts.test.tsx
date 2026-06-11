// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveBindings } from '../../../shared/shortcutDefaults'
import type { Command } from '../lib/commands'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'

// Hooks from a previous test must not stay subscribed to window: a leftover handler
// preventDefaults the shared event and the one under test then ignores it.
afterEach(cleanup)

function press(init: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent('keydown', init))
}

function setup(overlayOpen: boolean): { language: () => void; play: () => void } {
  const language = vi.fn()
  const play = vi.fn()
  const commands: Command[] = [
    { id: 'toggle-language', title: '', enabled: true, run: language },
    { id: 'play', title: '', enabled: true, run: play },
  ]
  renderHook(() =>
    useKeyboardShortcuts({
      isMac: true,
      overlayOpen,
      bindings: resolveBindings(),
      commands,
      onTogglePalette: () => {},
      onEscape: () => {},
    }),
  )
  return { language, play }
}

// The onboarding wizard (and every other modal) sets overlayOpen, which is meant to keep
// track shortcuts from acting on the list behind the dialog. The language toggle is global
// UI chrome, though — it has to keep working over the wizard so both locales can be reached
// before any track is loaded.
describe('useKeyboardShortcuts language toggle over an overlay', () => {
  it('runs the language toggle even while an overlay owns the screen', () => {
    const { language } = setup(true)
    press({ key: 'l', metaKey: true, shiftKey: true })
    expect(language).toHaveBeenCalledTimes(1)
  })

  it('still swallows ordinary track shortcuts while an overlay is open', () => {
    const { play } = setup(true)
    press({ key: ' ' })
    expect(play).not.toHaveBeenCalled()
  })
})

// A popover (the sort dropdown, the track context menu) that preventDefaults a key owns
// that press; the global handler must not also run a track command for it, or arrowing
// inside the popover moves the list selection behind it.
describe('useKeyboardShortcuts keys already handled below', () => {
  it('ignores a keydown a component already defaultPrevented', () => {
    const { play } = setup(false)
    const e = new KeyboardEvent('keydown', { key: ' ', cancelable: true })
    e.preventDefault()
    window.dispatchEvent(e)
    expect(play).not.toHaveBeenCalled()
  })

  it('still runs the command for an unhandled press', () => {
    const { play } = setup(false)
    press({ key: ' ', cancelable: true })
    expect(play).toHaveBeenCalledTimes(1)
  })
})
