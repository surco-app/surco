// Renders a keyboard shortcut for the host platform: macOS stacks glyphs with no
// separator (⇧⌘↩), while Windows/Linux spell the modifiers out joined with '+'
// (Ctrl+Shift+Enter), since ⌘ and the glyphs are mac-only. The named tokens map to a
// symbol; on mac the modifiers are reordered to Apple's ⌃⌥⇧⌘ and enter is ↩ (Return),
// as in every macOS menu, whatever order the chord was stored in. A single-character
// token (a letter, comma, slash) is upper-cased so the canonical lower-case chord
// renders as the familiar ⌘R / Ctrl+R.
const MAC: Record<string, string> = {
  mod: '⌘',
  alt: '⌥',
  ctrl: '⌃',
  shift: '⇧',
  enter: '↩',
  backspace: '⌫',
  space: '␣',
  up: '↑',
  down: '↓',
}
const MAC_MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'mod']
const OTHER: Record<string, string> = {
  mod: 'Ctrl',
  alt: 'Alt',
  ctrl: 'Ctrl',
  shift: 'Shift',
  enter: 'Enter',
  backspace: 'Backspace',
  space: '␣',
  up: '↑',
  down: '↓',
}

export function formatShortcut(keys: string[], mac: boolean): string {
  const map = mac ? MAC : OTHER
  const ordered = mac
    ? [
        ...MAC_MODIFIER_ORDER.filter((m) => keys.includes(m)),
        ...keys.filter((k) => !MAC_MODIFIER_ORDER.includes(k)),
      ]
    : keys
  const parts = ordered.map(
    (k) => map[k] ?? (k.length === 1 || /^f\d+$/.test(k) ? k.toUpperCase() : k),
  )
  return parts.join(mac ? '' : '+')
}
