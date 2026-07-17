import { useEffect } from 'react'
import type { Chord } from '../../../shared/shortcuts'
import { type Command, runCommand } from '../lib/commands'
import { isTypingTarget, keyToCommandId } from '../lib/keymap'
import { runKeyClaim } from '../lib/spaceClaim'
import { useLatest } from './useLatest'

interface Params {
  isMac: boolean
  // Whether any modal/overlay owns the screen, so global track shortcuts are swallowed
  // and don't act on the list behind the dialog.
  overlayOpen: boolean
  bindings: Map<string, Chord>
  // Builds the current command registry on demand. App keeps it lazy (not rebuilt every
  // render); the listener subscribes once and calls this at fire time for the latest state.
  getCommands: () => Command[]
  // ⌘K / Ctrl+K — toggles the command palette.
  onTogglePalette: () => void
  // Escape — closes the topmost open overlay (the priority chain lives in App).
  onEscape: () => void
  // Ctrl+↑/↓ — step the selection to the prev/next track. Handled here (not via the chord
  // table) because it must fire while a metadata field is focused, using the literal
  // Control key so it never collides with ⌘↑/↓ (start/end of a field) on macOS.
  onStepTrack: (dir: -1 | 1) => void
}

// The single global keydown handler: ⌘K toggles the palette, Escape closes the top
// overlay, and otherwise a bound key runs its command — unless an overlay is open or
// the user is typing. Subscribes once and reads the latest params through a ref, so App
// no longer mirrors each piece of state into a ref of its own.
export function useKeyboardShortcuts(params: Params): void {
  const latest = useLatest(params)
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      // A component that already handled this press (an open dropdown or context menu
      // moving its own focus) owns it — running a track command too would move the
      // selection behind the popover.
      if (e.defaultPrevented) return
      const p = latest.current
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        p.onTogglePalette()
        return
      }
      if (e.key === 'Escape') {
        p.onEscape()
        return
      }
      // Ctrl+↑/↓ steps tracks even mid-edit (the literal Control key, not ⌘, so it doesn't
      // fight macOS's ⌘↑/↓ caret jumps). Held out of the chord table so the typing guard
      // below can't suppress it. Meta must be up, or ⌃⌘↑ would double-fire.
      if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (p.overlayOpen) return
        e.preventDefault()
        p.onStepTrack(e.key === 'ArrowDown' ? 1 : -1)
        return
      }
      const typing = isTypingTarget(document.activeElement)
      const id = keyToCommandId(e, typing, p.bindings, p.isMac)
      if (!id) return
      // A section with its own transport (click repair's audition) claims Space
      // while it is open, so one press never starts BOTH its check and the
      // mini-player. Nothing claimed → the global play command runs as always.
      if (id === 'play' && !p.overlayOpen && runKeyClaim('play')) {
        e.preventDefault()
        return
      }
      // The language toggle is global UI chrome, not a list action, so it stays live even
      // over a modal — the onboarding wizard has no other way to reach the second locale.
      // Every other command is swallowed while an overlay owns the screen.
      if (p.overlayOpen && id !== 'toggle-language') return
      e.preventDefault()
      runCommand(p.getCommands(), id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [latest])
}
