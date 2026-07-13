// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveBindings } from '../../../shared/shortcutDefaults'
import type { Command } from '../lib/commands'
import { claimSpace } from '../lib/spaceClaim'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'

// Hooks from a previous test must not stay subscribed to window: a leftover handler
// preventDefaults the shared event and the one under test then ignores it.
afterEach(cleanup)

function press(init: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent('keydown', init))
}

function setup(overlayOpen: boolean): {
  language: () => void
  play: () => void
  stepTrack: ReturnType<typeof vi.fn>
} {
  const language = vi.fn()
  const play = vi.fn()
  const stepTrack = vi.fn()
  const commands: Command[] = [
    { id: 'toggle-language', title: '', enabled: true, group: 'app', run: language },
    { id: 'play', title: '', enabled: true, group: 'playback', run: play },
  ]
  renderHook(() =>
    useKeyboardShortcuts({
      isMac: true,
      overlayOpen,
      bindings: resolveBindings(),
      getCommands: () => commands,
      onTogglePalette: () => {},
      onEscape: () => {},
      onStepTrack: stepTrack,
    }),
  )
  return { language, play, stepTrack }
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

// Ctrl+↑/↓ steps the selection even mid-edit, using the literal Control key so it never
// collides with macOS's ⌘↑/↓ caret jumps. It's handled outside the chord table so the
// typing guard can't suppress it.
describe('useKeyboardShortcuts Ctrl+arrow track stepping', () => {
  it('steps to the next track on Ctrl+ArrowDown and the previous on Ctrl+ArrowUp', () => {
    const { stepTrack } = setup(false)
    press({ key: 'ArrowDown', ctrlKey: true })
    expect(stepTrack).toHaveBeenCalledWith(1)
    press({ key: 'ArrowUp', ctrlKey: true })
    expect(stepTrack).toHaveBeenCalledWith(-1)
  })

  // ⌘↑/↓ (mod) must stay the field's caret jump on macOS, so a Meta-held arrow never steps.
  it('does not step when Meta (⌘) is held instead of Ctrl', () => {
    const { stepTrack } = setup(false)
    press({ key: 'ArrowDown', metaKey: true })
    press({ key: 'ArrowUp', metaKey: true })
    expect(stepTrack).not.toHaveBeenCalled()
  })

  // While a modal owns the screen the list is inert, so stepping is swallowed too.
  it('does not step while an overlay is open', () => {
    const { stepTrack } = setup(true)
    press({ key: 'ArrowDown', ctrlKey: true })
    expect(stepTrack).not.toHaveBeenCalled()
  })
})

// A section with its own transport (the beatgrid's audition) claims Space while
// it is open. The whole point of the claim is that ONE press can't both check
// the grid and start the mini-player playing the whole track underneath.
describe('useKeyboardShortcuts space claim', () => {
  it('gives Space to a claiming section instead of the player, and returns it after', () => {
    const { play } = setup(false)
    const claimed = vi.fn()
    const release = claimSpace(claimed)
    press({ key: ' ' })
    expect(claimed).toHaveBeenCalledTimes(1)
    expect(play).not.toHaveBeenCalled()
    // Released (section folded or unmounted): the player gets its key back.
    release()
    press({ key: ' ' })
    expect(claimed).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledTimes(1)
  })
})
