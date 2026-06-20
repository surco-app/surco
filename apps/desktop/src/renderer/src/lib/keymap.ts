import { type Chord, type KeyLike, eventToChord } from '../../../shared/shortcuts'
import { matchChord } from '../../../shared/shortcutDefaults'

export function moveIndex(length: number, current: number, delta: number): number {
  if (length === 0) return -1
  if (current === -1) return 0
  return Math.min(length - 1, Math.max(0, current + delta))
}

// Absolute jump to the first or last row, used by Home/End. Unlike moveIndex it ignores
// the current position — End always lands on the last row even from an empty selection.
export function jumpIndex(length: number, to: 'first' | 'last'): number {
  if (length === 0) return -1
  return to === 'first' ? 0 : length - 1
}

// How many rows a PageUp/PageDown steps: the rows that fit in the viewport minus one, so
// the row at the edge carries over as context the way it does in Finder. Always ≥ 1 so a
// row taller than the viewport (or an unmeasured 0 step) still advances by one.
export function pageSize(viewport: number, rowStep: number): number {
  if (rowStep <= 0) return 1
  return Math.max(1, Math.floor(viewport / rowStep) - 1)
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
    // Home/End/PageUp/PageDown are fixed list-navigation aliases too — standard on every
    // platform, so they stay out of the rebind UI rather than adding four editable rows.
    if (chord[0] === 'home') return 'list-top'
    if (chord[0] === 'end') return 'list-bottom'
    if (chord[0] === 'pagedown') return 'list-page-down'
    if (chord[0] === 'pageup') return 'list-page-up'
  }
  return null
}
