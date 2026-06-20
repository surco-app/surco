// A keyboard chord, shared by the renderer keymap, the command-palette hints and the
// native menu accelerators so the three never drift. It is an ordered token array in
// canonical form: the `mod` then `shift` modifier tokens first, then exactly one key
// token, lowercased for letters (`r`, not `R`). `mod` means ⌘ on macOS and Ctrl
// elsewhere, matching formatShortcut and the menu's `CmdOrCtrl`.
export type Chord = string[]

export interface KeyLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
}

// The named tokens for keys whose `event.key` isn't a single printable character.
const NAMED: Record<string, string> = {
  Enter: 'enter',
  Backspace: 'backspace',
  ' ': 'space',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
}

// Canonical key token for an event.key, or null for keys we never bind (Tab, F-keys,
// lone modifiers, …). Single printable characters pass through lowercased.
function keyToken(key: string): string | null {
  if (key in NAMED) return NAMED[key]
  if (key.length === 1) return key.toLowerCase()
  return null
}

// Maps a key event to its canonical chord, or null for an unbindable key.
//
// Shift handling is asymmetric on purpose: for letters and named keys the shift is a
// real modifier we keep (so ⌘⇧R differs from ⌘R, and ⌘⇧↵ from ⌘↵). For a printable
// symbol that already requires shift (`?`, `:`, …) the character itself encodes the
// shift — the event arrives as `?`, not `/`+shift — so we drop the shift token, or the
// stored chord (`['?']`) would never match the event.
export function eventToChord(e: KeyLike, isMac: boolean): Chord | null {
  const token = keyToken(e.key)
  if (token === null) return null
  const chord: Chord = []
  if (isMac ? e.metaKey : e.ctrlKey) chord.push('mod')
  const shiftIsModifier = token.length > 1 || /^[a-z]$/.test(token)
  if (e.shiftKey && shiftIsModifier) chord.push('shift')
  chord.push(token)
  return chord
}

export function chordEquals(a: Chord, b: Chord): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i])
}

// Electron accelerator string for the native menu (e.g. ['mod','shift','r'] →
// 'CmdOrCtrl+Shift+R'). The renderer keymap stays the actual handler; this is only the
// label shown in the menu (built with registerAccelerator:false).
const ACCEL: Record<string, string> = {
  mod: 'CmdOrCtrl',
  shift: 'Shift',
  enter: 'Enter',
  backspace: 'Backspace',
  space: 'Space',
  up: 'Up',
  down: 'Down',
}

export function chordToAccelerator(chord: Chord): string {
  return chord.map((t) => ACCEL[t] ?? (t.length === 1 ? t.toUpperCase() : t)).join('+')
}
