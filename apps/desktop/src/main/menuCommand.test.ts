import { describe, expect, it, vi } from 'vitest'
import { keymapMenuClick } from './menuCommand'

describe('keymapMenuClick', () => {
  // The renderer keymap owns these accelerators and applies the "not while
  // typing" guard. If the menu also ran the command on its keyboard accelerator,
  // Space would start playback while the user is typing in the Discogs search
  // field — the very guard the keymap exists to provide.
  it('ignores keyboard-accelerator clicks and leaves the keystroke to the keymap', () => {
    const run = vi.fn()
    keymapMenuClick(run, 'play')({}, undefined, { triggeredByAccelerator: true })
    expect(run).not.toHaveBeenCalled()
  })

  it('runs the command on an explicit mouse click of the menu item', () => {
    const run = vi.fn()
    keymapMenuClick(run, 'play')({}, undefined, { triggeredByAccelerator: false })
    expect(run).toHaveBeenCalledWith('play')
  })
})
