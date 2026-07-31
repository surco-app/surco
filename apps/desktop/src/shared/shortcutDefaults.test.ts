import { describe, expect, it } from 'vitest'
import { buildCommands, type CommandDeps } from '../renderer/src/lib/commands'
import { findConflicts, matchChord, resolveBindings, SHORTCUT_DEFAULTS } from './shortcutDefaults'

describe('resolveBindings', () => {
  it('returns the defaults when there are no overrides', () => {
    const b = resolveBindings()
    expect(b.get('add')).toEqual(['mod', 'o'])
    expect(b.get('rename')).toEqual(['mod', 'shift', 'r'])
  })

  it('applies an override and ignores unknown command ids', () => {
    const b = resolveBindings({ add: ['mod', 'shift', 'a'], nope: ['x'] })
    expect(b.get('add')).toEqual(['mod', 'shift', 'a'])
    expect(b.has('nope')).toBe(false)
  })

  // An empty-array override is a deliberate unbind, so the matcher stops firing it.
  it('treats an empty-array override as unbound', () => {
    const b = resolveBindings({ play: [] })
    expect(b.get('play')).toEqual([])
    expect(matchChord(b, ['space'], false)).toBeNull()
  })
})

describe('matchChord', () => {
  const b = resolveBindings()

  it('resolves the default chords to their commands', () => {
    expect(matchChord(b, ['mod', 'enter'], false)).toBe('process-current')
    expect(matchChord(b, ['mod', 'shift', 'enter'], false)).toBe('process-all')
    expect(matchChord(b, ['mod', 'r'], false)).toBe('reveal')
    expect(matchChord(b, ['mod', 'shift', 'r'], false)).toBe('rename')
    expect(matchChord(b, ['mod', 'f'], false)).toBe('find-replace')
    expect(matchChord(b, ['mod', 'shift', 'm'], false)).toBe('add-apple-music')
    expect(matchChord(b, ['?'], false)).toBe('shortcuts')
    expect(matchChord(b, ['/'], false)).toBe('search')
  })

  // The list-wide toolbar actions are bindable too, so the palette, the keymap and the
  // Shortcuts tab all expose them.
  it('resolves the list-wide action chords', () => {
    expect(matchChord(b, ['mod', 'a'], false)).toBe('select-all')
    expect(matchChord(b, ['mod', 'shift', 'f'], false)).toBe('fill-all')
    expect(matchChord(b, ['mod', 'shift', 'a'], false)).toBe('analyze-quality')
    expect(matchChord(b, ['mod', 'shift', 'd'], false)).toBe('auto-match')
    expect(matchChord(b, ['mod', 'shift', 'e'], false)).toBe('export')
    expect(matchChord(b, ['mod', 'shift', 's'], false)).toBe('stats')
    expect(matchChord(b, ['mod', 'shift', 'l'], false)).toBe('toggle-language')
  })

  // ⌘A has to keep selecting text inside a field; only outside one does it select every
  // track, so it carries the typing guard despite being a mod-combo.
  it('suppresses select-all while typing so ⌘A still selects text in a field', () => {
    expect(matchChord(b, ['mod', 'a'], true)).toBeNull()
    expect(matchChord(b, ['mod', 'a'], false)).toBe('select-all')
  })

  // Mod-combos still fire while typing (so ⌘⏎ converts mid-edit), but bare keys don't
  // (so Space types a space) and ⌘⌫ is suppressed (so ⌫ deletes text, not the track).
  it('applies the typing guard: mod-combos fire, bare keys and ⌘⌫ do not', () => {
    expect(matchChord(b, ['mod', 'enter'], true)).toBe('process-current')
    expect(matchChord(b, ['space'], true)).toBeNull()
    expect(matchChord(b, ['space'], false)).toBe('play')
    expect(matchChord(b, ['mod', 'backspace'], true)).toBeNull()
    expect(matchChord(b, ['mod', 'backspace'], false)).toBe('remove')
  })

  // The editor's own clean-up actions (Tag / Eraser) and the fake-purge get first-class
  // chords so the keyboard-first flow doesn't have to detour through ⌘K for them.
  it('resolves the editor and quality clean-up chords', () => {
    expect(matchChord(b, ['mod', 't'], false)).toBe('derive-tags')
    expect(matchChord(b, ['mod', 'e'], false)).toBe('clear-meta')
    expect(matchChord(b, ['mod', 'shift', 'backspace'], false)).toBe('trash-suspects')
  })

  // derive-tags / clear-meta are editor actions the user may fire with a field focused (like
  // the column-jump chords), so they stay live while typing. trash-suspects deletes files, so
  // it carries the typing guard like ⌘⌫ remove — ⌫ mid-edit must never purge the crate.
  it('keeps the editor chords live while typing but guards the destructive trash-suspects', () => {
    expect(matchChord(b, ['mod', 't'], true)).toBe('derive-tags')
    expect(matchChord(b, ['mod', 'e'], true)).toBe('clear-meta')
    expect(matchChord(b, ['mod', 'shift', 'backspace'], true)).toBeNull()
    expect(matchChord(b, ['mod', 'shift', 'backspace'], false)).toBe('trash-suspects')
  })

  it('returns null for an unbound chord', () => {
    expect(matchChord(b, ['mod', '9'], false)).toBeNull()
  })

  // ⌘Z is the undo for batch tag operations only while the focus is out of a field —
  // mid-edit the press must fall through to the native in-field text undo instead.
  it('suppresses undo-meta while typing so a field keeps its native text undo', () => {
    expect(matchChord(b, ['mod', 'z'], false)).toBe('undo-meta')
    expect(matchChord(b, ['mod', 'z'], true)).toBeNull()
  })
})

describe('findConflicts', () => {
  it('reports no conflicts for the defaults', () => {
    expect(findConflicts(resolveBindings())).toEqual([])
  })

  it('groups commands that resolve to the same chord', () => {
    const conflicts = findConflicts(resolveBindings({ reveal: ['mod', 'o'] }))
    expect(conflicts).toEqual([['add', 'reveal']])
  })
})

describe('matchChord con ámbito', () => {
  it('no dispara un comando de ámbito cuando no hay ámbito activo', () => {
    const bindings = new Map([['trim-audition', ['a']]])
    expect(matchChord(bindings, ['a'], false, null)).toBeNull()
  })

  it('dispara un comando de ámbito cuando su ámbito está activo', () => {
    const bindings = new Map([['trim-audition', ['a']]])
    expect(matchChord(bindings, ['a'], false, 'trim')).toBe('trim-audition')
  })

  it('no dispara un comando de ámbito bajo un ámbito distinto', () => {
    const bindings = new Map([['trim-audition', ['a']]])
    expect(matchChord(bindings, ['a'], false, 'otro')).toBeNull()
  })

  it('sigue disparando los comandos globales dentro de un ámbito', () => {
    const bindings = new Map([['settings', ['mod', ',']]])
    expect(matchChord(bindings, ['mod', ','], false, 'trim')).toBe('settings')
  })

  // Con la tabla real: ← está ligada a seek-back (global) y a trim-nudge-back (scope
  // 'trim'). Dentro del editor de silencios manda la del ámbito, o la flecha adelantaría
  // la reproducción en vez de mover el corte.
  it('prefiere el comando de ámbito al global que comparte chord', () => {
    const bindings = resolveBindings()
    expect(matchChord(bindings, ['left'], false, 'trim')).toBe('trim-nudge-back')
    expect(matchChord(bindings, ['right'], false, 'trim')).toBe('trim-nudge-forward')
  })

  it('deja el chord compartido al comando global fuera del ámbito', () => {
    const bindings = resolveBindings()
    expect(matchChord(bindings, ['left'], false, null)).toBe('seek-back')
  })
})

describe('findConflicts con ámbito', () => {
  it('no marca conflicto entre un comando de ámbito y uno global', () => {
    const bindings = new Map([
      ['trim-audition', ['a']],
      ['add', ['a']],
    ])
    expect(findConflicts(bindings)).toEqual([])
  })

  it('marca conflicto entre dos comandos del mismo ámbito', () => {
    const bindings = new Map([
      ['trim-audition', ['a']],
      ['trim-clear', ['a']],
    ])
    expect(findConflicts(bindings)).toEqual([['trim-audition', 'trim-clear']])
  })
})

// Las dos regresiones de esta rama fueron el mismo defecto: una tecla que matchChord
// resuelve pero que nadie ejecuta, así que preventDefault la mata sin hacer nada. Un
// comando sin scope lo ejecuta el listener global vía runCommand, luego TIENE que estar
// en el registro; uno con scope lo ejecuta el onKeyDown del componente de ese ámbito.
describe('cada atajo lo ejecuta alguien', () => {
  // buildCommands solo lee sus deps para decidir enabled/run, así que unas dependencias
  // inertes bastan para extraer los ids que el registro declara.
  const registeredIds = new Set(
    buildCommands(
      new Proxy({} as CommandDeps, {
        get: (_t, key) => {
          if (key === 'tr' || key === 'hintFor') return () => ''
          if (key === 'platform') return 'darwin'
          if (key === 'titleFormatSet' || key === 'playerVisible' || key === 'batching')
            return false
          if (key === 'selected' || key === 'settings' || key === 'analysis') return null
          if (key === 'matching') return null
          if (key === 'selectedTracksCount' || key === 'autoMatchable') return 0
          if (key === 'tracks' || key === 'visibleTracks' || key === 'bulkTracks') return []
          if (key.toString().endsWith('Ref')) return { current: null }
          return () => undefined
        },
      }),
    ).map((c) => c.id),
  )

  for (const def of SHORTCUT_DEFAULTS) {
    if (def.scope) continue
    it(`registra el comando global '${def.id}' para que runCommand lo encuentre`, () => {
      expect(registeredIds).toContain(def.id)
    })
  }
})
