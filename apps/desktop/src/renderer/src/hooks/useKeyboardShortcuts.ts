import { useEffect } from 'react'
import type { Chord } from '../../../shared/shortcuts'
import { type Command, runCommand } from '../lib/commands'
import { isTypingTarget, keyToCommandId } from '../lib/keymap'
import { useLatest } from './useLatest'

interface Params {
  isMac: boolean
  // Whether any modal/overlay owns the screen, so global track shortcuts are swallowed
  // and don't act on the list behind the dialog.
  overlayOpen: boolean
  bindings: Map<string, Chord>
  commands: Command[]
  // ⌘K / Ctrl+K — toggles the command palette.
  onTogglePalette: () => void
  // Escape — closes the topmost open overlay (the priority chain lives in App).
  onEscape: () => void
}

// The single global keydown handler: ⌘K toggles the palette, Escape closes the top
// overlay, and otherwise a bound key runs its command — unless an overlay is open or
// the user is typing. Subscribes once and reads the latest params through a ref, so App
// no longer mirrors each piece of state into a ref of its own.
export function useKeyboardShortcuts(params: Params): void {
  const latest = useLatest(params)
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
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
      const id = keyToCommandId(e, isTypingTarget(document.activeElement), p.bindings, p.isMac)
      if (!id) return
      // The language toggle is global UI chrome, not a list action, so it stays live even
      // over a modal — the onboarding wizard has no other way to reach the second locale.
      // Every other command is swallowed while an overlay owns the screen.
      if (p.overlayOpen && id !== 'toggle-language') return
      e.preventDefault()
      runCommand(p.commands, id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [latest])
}
