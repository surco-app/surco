// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { resolveBindings } from '../../../shared/shortcutDefaults'
import type { Command } from '../lib/commands'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'

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
