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
  // Limita el comando al ámbito con ese nombre: solo dispara cuando el foco está dentro
  // de un `[data-shortcut-scope]` que coincide. Sin scope el comando es global.
  scope?: string
  // Bajo qué encabezado se lista en Ajustes. Por defecto se hereda del grupo que el
  // comando ya declara en la paleta (⌘K), para que la app tenga UNA taxonomía y no dos
  // que acaben divergiendo; este campo solo hace falta cuando el comando no vive en el
  // registro —lo ejecuta un componente— y por tanto no tiene grupo del que heredar.
  group?: string
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
  // Shift+F10 is the Windows/Linux convention for a context menu; macOS has no
  // convention of its own, so we share it. Without it, four menu actions (copy/paste
  // metadata, start over, copy path) have no keyboard path at all.
  //
  // Con ámbito porque quien lo ejecuta es el onKeyDown de la fila (necesita sus
  // coordenadas para colocar el menú), no el registro de comandos: como global, una
  // reasignación a ⌘P mataría esa tecla en toda la app sin ejecutar nada.
  { group: 'navigate', id: 'track-menu', chord: ['shift', 'f10'], scope: 'track-list' },
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
  // Saltar de sección a sección por sus cabeceras, sin cruzar los campos de dentro: con
  // una sola sección abierta el editor tiene 133 paradas de tabulador. Llevan `mod` para
  // seguir vivas con un campo enfocado — irse al recorte desde el título es el caso — y
  // son corchetes porque ⌘↓/⌘⇧↓ son atajos de edición de texto en macOS y estas teclas
  // conviven con el tecleo. `mod` es ⌘ en macOS y Ctrl en Windows y Linux.
  { group: 'navigate', id: 'section-next', chord: ['mod', ']'], scope: 'editor' },
  { group: 'navigate', id: 'section-prev', chord: ['mod', '['], scope: 'editor' },
  // Editor de silencios. Una tecla por lado y acción: con el editor desplegado actúan
  // sobre la pista abierta SIN foco en ninguna parte, que es como se maneja un teclado
  // de macros — se pulsa y el corte se mueve, en vez de tener que pinchar antes el
  // tirador. Sin foco que desambigüe, la tecla ES el lado. Teclas sueltas: la sección
  // cerrada las deja libres, y el guardián de tecleo las calla con un campo enfocado.
  // Mano izquierda para el corte de entrada, derecha para el de salida, como en la onda.
  { group: 'trim', id: 'trim-start-back', chord: ['q'] },
  { group: 'trim', id: 'trim-start-forward', chord: ['w'] },
  { group: 'trim', id: 'trim-start-audition', chord: ['a'] },
  { group: 'trim', id: 'trim-start-clear', chord: ['z'] },
  { group: 'trim', id: 'trim-end-back', chord: ['o'] },
  { group: 'trim', id: 'trim-end-forward', chord: ['p'] },
  { group: 'trim', id: 'trim-end-audition', chord: ['l'] },
  { group: 'trim', id: 'trim-end-clear', chord: ['.'] },
  // La lupa de cada lado: acercar para colocar el corte al milisegundo, alejar para ver
  // dónde cae dentro de la pista. Es parte del recorte, no un paso aparte, así que sin
  // tecla obligaba a ir al ratón en mitad de un flujo que ya era de teclado.
  { group: 'trim', id: 'trim-start-zoom-in', chord: ['e'] },
  { group: 'trim', id: 'trim-start-zoom-out', chord: ['d'] },
  { group: 'trim', id: 'trim-end-zoom-in', chord: ['i'] },
  // ',' y no 'k': la k es alias fijo de "pista anterior" (vim), y queda junto al '.'
  // que ya es del corte de salida.
  { group: 'trim', id: 'trim-end-zoom-out', chord: [','] },
  // La detección propone los dos cortes a la vez, así que aplicarla es una sola acción.
  { group: 'trim', id: 'trim-apply', chord: ['s'] },
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
//
// The active scope's commands are matched BEFORE the global ones, so a scoped binding
// beats a global that shares its chord: ← is seek-back everywhere, but inside the
// silence editor it nudges the cut. Without that precedence the table's order would
// decide, and seek-back is declared first.
export function matchChord(
  bindings: Map<string, Chord>,
  chord: Chord,
  typing: boolean,
  scope: string | null = null,
): string | null {
  const hasMod = chord.includes('mod')
  const match = (wantScoped: boolean): string | null => {
    for (const def of SHORTCUT_DEFAULTS) {
      const bound = bindings.get(def.id)
      if (!bound || bound.length === 0 || !chordEquals(bound, chord)) continue
      if (def.scope && def.scope !== scope) continue
      if (Boolean(def.scope) !== wantScoped) continue
      if (typing && (!hasMod || def.suppressWhileTyping)) return null
      return def.id
    }
    return null
  }
  return (scope !== null ? match(true) : null) ?? match(false)
}

// Groups of command ids that resolve to the same chord — used by the Shortcuts tab to
// flag a clash before it's saved. Unbound (`[]`) commands are ignored.
export function findConflicts(bindings: Map<string, Chord>): string[][] {
  const scopeOf = new Map(SHORTCUT_DEFAULTS.map((d) => [d.id, d.scope ?? '']))
  const byChord = new Map<string, string[]>()
  for (const [id, chord] of bindings) {
    if (chord.length === 0) continue
    const key = `${scopeOf.get(id) ?? ''}:${chord.join('+')}`
    const ids = byChord.get(key) ?? []
    ids.push(id)
    byChord.set(key, ids)
  }
  return [...byChord.values()].filter((ids) => ids.length > 1)
}
