// Renders a keyboard shortcut for the host platform: macOS stacks glyphs with no
// separator (⌘⇧↵), while Windows/Linux spell the modifiers out joined with '+'
// (Ctrl+Shift+Enter), since ⌘ and the glyphs are mac-only. The tokens
// mod/shift/enter/backspace map to the right symbol; anything else (a letter, a
// comma) passes through unchanged.
const MAC: Record<string, string> = { mod: '⌘', shift: '⇧', enter: '↵', backspace: '⌫' }
const OTHER: Record<string, string> = {
  mod: 'Ctrl',
  shift: 'Shift',
  enter: 'Enter',
  backspace: 'Backspace',
}

export function formatShortcut(keys: string[], mac: boolean): string {
  const map = mac ? MAC : OTHER
  const parts = keys.map((k) => map[k] ?? k)
  return parts.join(mac ? '' : '+')
}
