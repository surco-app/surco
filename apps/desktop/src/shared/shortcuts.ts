// A keyboard chord, shared by the renderer keymap, the command-palette hints and the
// native menu accelerators so the three never drift. It is an ordered token array in
// canonical form: the `mod`, `alt`, `ctrl` and `shift` modifier tokens in that order,
// then exactly one key token, lowercased for letters (`r`, not `R`). `mod` means ⌘ on
// macOS and Ctrl elsewhere, matching formatShortcut and the menu's `CmdOrCtrl`; `ctrl`
// is macOS-only, since Ctrl is already `mod` on the other platforms.
export type Chord = string[]

export interface KeyLike {
  key: string
  // La posición física de la tecla (`KeyE`, `Comma`…). Opcional porque los tests y los
  // llamantes antiguos pasan objetos planos; los eventos reales del navegador siempre
  // la traen.
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  altKey?: boolean
  shiftKey: boolean
}

// The named tokens for keys whose `event.key` isn't a single printable character.
const NAMED: Record<string, string> = {
  Enter: 'enter',
  Backspace: 'backspace',
  ' ': 'space',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  F10: 'f10',
}

// Canonical key token for an event.key, or null for keys we never bind (Tab, F-keys,
// lone modifiers, …). Single printable characters pass through lowercased.
function keyToken(key: string): string | null {
  if (key in NAMED) return NAMED[key]
  if (key.length === 1) return key.toLowerCase()
  return null
}

// El token de una POSICIÓN de teclado, para los chords que llevan alt o ctrl. En macOS
// ⌥E no produce `e` sino `´`, así que guardar el carácter ataría el atajo a la
// distribución; un teclado de macros manda posiciones y su firmware se configura por
// posición, que es justo lo que hace falta que sobreviva al cambio de máquina.
function codeToken(code: string | undefined): string | null {
  if (!code) return null
  if (code.startsWith('Key')) return code.slice(3).toLowerCase()
  if (code.startsWith('Digit')) return code.slice(5)
  const PUNCT: Record<string, string> = {
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
  }
  return PUNCT[code] ?? null
}

// Maps a key event to its canonical chord, or null for an unbindable key.
//
// Shift handling is asymmetric on purpose: for letters and named keys the shift is a
// real modifier we keep (so ⌘⇧R differs from ⌘R, and ⌘⇧↵ from ⌘↵). For a printable
// symbol that already requires shift (`?`, `:`, …) the character itself encodes the
// shift — the event arrives as `?`, not `/`+shift — so we drop the shift token, or the
// stored chord (`['?']`) would never match the event.
export function eventToChord(e: KeyLike, isMac: boolean): Chord | null {
  const named = e.key in NAMED
  // Con alt o ctrl la tecla se identifica por posición (ver codeToken); las teclas con
  // nombre (flechas, Enter…) no dependen de la distribución y conservan su token.
  const physical = (e.altKey === true || (isMac && e.ctrlKey)) && !named
  const token = physical ? (codeToken(e.code) ?? keyToken(e.key)) : keyToken(e.key)
  if (token === null) return null
  const chord: Chord = []
  if (isMac ? e.metaKey : e.ctrlKey) chord.push('mod')
  if (e.altKey === true) chord.push('alt')
  if (isMac && e.ctrlKey) chord.push('ctrl')
  const shiftIsModifier = physical || token.length > 1 || /^[a-z]$/.test(token)
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
  alt: 'Alt',
  ctrl: 'Control',
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
