// Renders a keyboard shortcut for the host platform: macOS stacks glyphs with no
// separator (⌘⇧↵), while Windows/Linux spell the modifiers out joined with '+'
// (Ctrl+Shift+Enter), since ⌘ and the glyphs are mac-only. The named tokens map to a
// symbol; a single-character token (a letter, comma, slash) is upper-cased so the
// canonical lower-case chord renders as the familiar ⌘R / Ctrl+R.
const MAC: Record<string, string> = {
  mod: '⌘',
  shift: '⇧',
  enter: '↵',
  backspace: '⌫',
  space: '␣',
  up: '↑',
  down: '↓',
}
const OTHER: Record<string, string> = {
  mod: 'Ctrl',
  shift: 'Shift',
  enter: 'Enter',
  backspace: 'Backspace',
  space: '␣',
  up: '↑',
  down: '↓',
}

export function formatShortcut(keys: string[], mac: boolean): string {
  const map = mac ? MAC : OTHER
  const parts = keys.map((k) => map[k] ?? (k.length === 1 ? k.toUpperCase() : k))
  return parts.join(mac ? '' : '+')
}
