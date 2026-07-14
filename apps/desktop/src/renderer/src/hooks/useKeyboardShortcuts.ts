import { useEffect } from 'react'
import type { Chord } from '../../../shared/shortcuts'
import { type Command, runCommand } from '../lib/commands'
import { isTypingTarget, keyToCommandId } from '../lib/keymap'
import { type ClaimedKey, runKeyClaim } from '../lib/spaceClaim'
import { useLatest } from './useLatest'

// The bare keys an open lane may claim for itself. Kept as a table so the guard
// that protects them (not typing, no overlay, no modifier) is written once —
// each new lane verb is one entry, not another copy of the same four conditions.
const LANE_KEYS: Record<string, ClaimedKey> = {
  c: 'centre-beat',
  g: 'add-segment',
}

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
      // The open lane's own bare keys: C centres the nearest beat (rekordbox's),
      // G starts a new grid segment under the reference. Bare letters, so they
      // never fight a chord — and each acts only while a section actually claims
      // it (nothing claimed → the key stays free for the list commands).
      const typing = isTypingTarget(document.activeElement)
      const bare = !typing && !p.overlayOpen && !e.metaKey && !e.ctrlKey && !e.altKey
      const laneKey = LANE_KEYS[e.key.toLowerCase()]
      if (bare && laneKey && runKeyClaim(laneKey)) {
        e.preventDefault()
        return
      }
      const id = keyToCommandId(e, typing, p.bindings, p.isMac)
      if (!id) return
      // A section with its own transport (the beatgrid's audition) claims Space
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
