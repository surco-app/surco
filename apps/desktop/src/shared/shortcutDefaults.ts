import { type Chord, chordEquals } from './shortcuts'

// The single source of truth for which key runs which command. The renderer matcher,
// the palette/menu hints and the native-menu accelerators all derive from this table
// (plus the user's per-command overrides), so the three surfaces can't drift.
//
// `suppressWhileTyping` keeps a mod-combo from firing while a text field is focused —
// only ⌘⌫ (remove) needs it, so ⌫ stays a backspace mid-edit instead of deleting the
// track. Bare-key chords are always suppressed while typing regardless of this flag.
interface ShortcutDef {
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
  { id: 'seek-back', chord: ['left'] },
  { id: 'seek-forward', chord: ['right'] },
  { id: 'search', chord: ['/'] },
  // List-wide toolbar actions. select-all keeps the typing guard so ⌘A still selects
  // text inside a field; the rest are mod-combos that stay live while editing, matching
  // rename (⌘⇧R) and the other toolbar shortcuts.
  { id: 'select-all', chord: ['mod', 'a'], suppressWhileTyping: true },
  { id: 'fill-all', chord: ['mod', 'shift', 'f'] },
  // The editor's own Tag (fill selection from file name) and Eraser (clear selection) buttons,
  // as chords so the keyboard flow reaches them without a ⌘K detour. Mod-combos with no typing
  // guard, like the column jumps, so they still fire with a metadata field focused.
  { id: 'derive-tags', chord: ['mod', 't'] },
  { id: 'clear-meta', chord: ['mod', 'e'] },
  // Undoes the last batch tag operation (fill-all, find & replace, clear, paste, derive).
  // Typing-guarded like ⌘A: while a field is focused the press falls through to the
  // native Edit-menu Undo, so text edits keep their own in-field history.
  { id: 'undo-meta', chord: ['mod', 'z'], suppressWhileTyping: true },
  // Move the flagged (suspect) rips to the Trash. Guarded while typing like ⌘⌫ remove — it
  // deletes files, so ⌫ mid-edit must never trigger it.
  { id: 'trash-suspects', chord: ['mod', 'shift', 'backspace'], suppressWhileTyping: true },
  { id: 'analyze-quality', chord: ['mod', 'shift', 'a'] },
  { id: 'auto-match', chord: ['mod', 'shift', 'd'] },
  { id: 'export', chord: ['mod', 'shift', 'e'] },
  { id: 'stats', chord: ['mod', 'shift', 's'] },
  { id: 'toggle-language', chord: ['mod', 'shift', 'l'] },
  // Jump focus between the three columns — list, Discogs matches, editor. mod-combos so
  // they fire while a field is focused (the same key jumps you out of the editor).
  { id: 'focus-list', chord: ['mod', '1'] },
  { id: 'focus-matches', chord: ['mod', '2'] },
  { id: 'focus-editor', chord: ['mod', '3'] },
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
