import { type Chord, chordEquals } from './shortcuts'

// The single source of truth for which key runs which command. The renderer matcher,
// the palette/menu hints and the native-menu accelerators all derive from this table
// (plus the user's per-command overrides), so the three surfaces can't drift.
//
// `suppressWhileTyping` keeps a mod-combo from firing while a text field is focused —
// only ⌘⌫ (remove) needs it, so ⌫ stays a backspace mid-edit instead of deleting the
// track. Bare-key chords are always suppressed while typing regardless of this flag.
export interface ShortcutDef {
  id: string
  chord: Chord
  suppressWhileTyping?: boolean
}

export const SHORTCUT_DEFAULTS: ShortcutDef[] = [
  { id: 'process-current', chord: ['mod', 'enter'] },
  { id: 'process-all', chord: ['mod', 'shift', 'enter'] },
  { id: 'add', chord: ['mod', 'o'] },
  { id: 'find-replace', chord: ['mod', 'f'] },
  { id: 'rename', chord: ['mod', 'shift', 'r'] },
  { id: 'reveal', chord: ['mod', 'r'] },
  { id: 'add-apple-music', chord: ['mod', 'shift', 'm'] },
  { id: 'remove', chord: ['mod', 'backspace'], suppressWhileTyping: true },
  { id: 'settings', chord: ['mod', ','] },
  { id: 'shortcuts', chord: ['?'] },
  { id: 'play', chord: ['space'] },
  { id: 'next', chord: ['down'] },
  { id: 'prev', chord: ['up'] },
  { id: 'search', chord: ['/'] },
  // List-wide toolbar actions. select-all keeps the typing guard so ⌘A still selects
  // text inside a field; the rest are mod-combos that stay live while editing, matching
  // rename (⌘⇧R) and the other toolbar shortcuts.
  { id: 'select-all', chord: ['mod', 'a'], suppressWhileTyping: true },
  { id: 'fill-all', chord: ['mod', 'shift', 'f'] },
  { id: 'analyze-quality', chord: ['mod', 'shift', 'a'] },
  { id: 'auto-match', chord: ['mod', 'shift', 'd'] },
  { id: 'export', chord: ['mod', 'shift', 'e'] },
  { id: 'stats', chord: ['mod', 'shift', 's'] },
]

// The effective binding per command id: defaults with the user's overrides applied. An
// override of `[]` deliberately unbinds a command (the matcher never matches an empty
// chord). Overrides for unknown ids are ignored.
export function resolveBindings(overrides: Record<string, Chord> = {}): Map<string, Chord> {
  const map = new Map<string, Chord>()
  for (const def of SHORTCUT_DEFAULTS) map.set(def.id, def.chord)
  for (const def of SHORTCUT_DEFAULTS) {
    const override = overrides[def.id]
    if (override) map.set(def.id, override)
  }
  return map
}

// Resolves a pressed chord to a command id. Iterates the defaults table so the result
// is deterministic (first match wins) even if two commands share a chord. Respects the
// typing guard: while a field is focused, bare-key chords and `suppressWhileTyping`
// commands don't fire, but other mod-combos do.
export function matchChord(
  bindings: Map<string, Chord>,
  chord: Chord,
  typing: boolean,
): string | null {
  const hasMod = chord.includes('mod')
  for (const def of SHORTCUT_DEFAULTS) {
    const bound = bindings.get(def.id)
    if (!bound || bound.length === 0 || !chordEquals(bound, chord)) continue
    if (typing && (!hasMod || def.suppressWhileTyping)) return null
    return def.id
  }
  return null
}

// Groups of command ids that resolve to the same chord — used by the Shortcuts tab to
// flag a clash before it's saved. Unbound (`[]`) commands are ignored.
export function findConflicts(bindings: Map<string, Chord>): string[][] {
  const byChord = new Map<string, string[]>()
  for (const [id, chord] of bindings) {
    if (chord.length === 0) continue
    const key = chord.join('+')
    const ids = byChord.get(key) ?? []
    ids.push(id)
    byChord.set(key, ids)
  }
  return [...byChord.values()].filter((ids) => ids.length > 1)
}
