import { type Chord, type KeyLike, eventToChord } from '../../../shared/shortcuts'
import { matchChord } from '../../../shared/shortcutDefaults'

export function moveIndex(length: number, current: number, delta: number): number {
  if (length === 0) return -1
  if (current === -1) return 0
  return Math.min(length - 1, Math.max(0, current + delta))
}

// Whether the focused element owns the keystroke, so the global shortcuts keep
// their hands off it. Beyond text fields this includes <select> (its own arrow
// and space keys drive the options — e.g. the album-match dropdown) and any
// contenteditable surface.
export function isTypingTarget(
  el: { tagName: string; isContentEditable?: boolean } | null,
): boolean {
  if (!el) return false
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable === true
  )
}

// Resolves a key event to a command id using the configurable bindings, falling back
// to the fixed vim aliases. `bindings` is the merged defaults+overrides map; `isMac`
// picks ⌘ vs Ctrl as the `mod` key.
export function keyToCommandId(
  e: KeyLike,
  typing: boolean,
  bindings: Map<string, Chord>,
  isMac: boolean,
): string | null {
  const chord = eventToChord(e, isMac)
  if (!chord) return null
  const id = matchChord(bindings, chord, typing)
  if (id) return id
  // j/k are fixed vim aliases for list navigation — deliberately not configurable and
  // not shown in the Shortcuts tab, so power-user muscle memory keeps working without a
  // second editable row per command. Only when a field doesn't own the keystroke.
  if (!typing && chord.length === 1) {
    if (chord[0] === 'j') return 'next'
    if (chord[0] === 'k') return 'prev'
  }
  return null
}
