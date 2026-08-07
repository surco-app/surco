import { describe, expect, it } from 'vitest'
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

  // La clave del conflicto es el chord completo, así que ⌥E y E no chocan. Es lo que
  // permite que un teclado de macros use combinaciones sin desplazar los atajos de siempre.
  it('no marca conflicto entre una tecla y la misma con un modificador', () => {
    const bindings = new Map([
      ['add', ['alt', 'e']],
      ['reveal', ['e']],
    ])
    expect(findConflicts(bindings)).toEqual([])
  })
})

describe('matchChord con ámbito', () => {
  it('no dispara un comando de ámbito cuando no hay ámbito activo', () => {
    const bindings = new Map([['track-menu', ['shift', 'f10']]])
    expect(matchChord(bindings, ['shift', 'f10'], false, null)).toBeNull()
  })

  it('dispara un comando de ámbito cuando su ámbito está activo', () => {
    const bindings = new Map([['track-menu', ['shift', 'f10']]])
    expect(matchChord(bindings, ['shift', 'f10'], false, 'track-list')).toBe('track-menu')
  })

  it('no dispara un comando de ámbito bajo un ámbito distinto', () => {
    const bindings = new Map([['track-menu', ['shift', 'f10']]])
    expect(matchChord(bindings, ['shift', 'f10'], false, 'otro')).toBeNull()
  })

  it('sigue disparando los comandos globales dentro de un ámbito', () => {
    const bindings = new Map([['settings', ['mod', ',']]])
    expect(matchChord(bindings, ['mod', ','], false, 'track-list')).toBe('settings')
  })

  // Un comando de ámbito gana al global que comparte su chord mientras ese ámbito está
  // activo: si mandara el orden de la tabla, el global declarado antes se lo quedaría.
  // Hoy ningún par de la tabla real colisiona, así que se prueba con un mapa propio.
  it('prefiere el comando de ámbito al global que comparte chord', () => {
    const bindings = new Map([
      ['seek-back', ['left']],
      ['track-menu', ['left']],
    ])
    expect(matchChord(bindings, ['left'], false, 'track-list')).toBe('track-menu')
    expect(matchChord(bindings, ['left'], false, null)).toBe('seek-back')
  })
})

// j/k (y Home/End/RePág/AvPág) son alias fijos de navegación por la lista: no se
// configuran ni salen en Ajustes, así que un chord por defecto que los pise gana en la
// tabla y deja al alias sin efecto, en silencio. Pasó con la lupa del recorte, que
// arrancó en 'k' y se comía "pista anterior".
describe('los alias fijos de lista', () => {
  const FIJOS = ['j', 'k', 'home', 'end', 'pageup', 'pagedown']

  it('no los pisa ningún atajo por defecto', () => {
    const pisados = SHORTCUT_DEFAULTS.filter(
      (d) => d.chord.length === 1 && FIJOS.includes(d.chord[0]),
    ).map((d) => d.id)
    expect(pisados).toEqual([])
  })
})

describe('findConflicts con ámbito', () => {
  it('no marca conflicto entre un comando de ámbito y uno global', () => {
    const bindings = new Map([
      ['track-menu', ['a']],
      ['add', ['a']],
    ])
    expect(findConflicts(bindings)).toEqual([])
  })

  it('marca conflicto entre dos comandos globales con el mismo chord', () => {
    const bindings = new Map([
      ['add', ['a']],
      ['reveal', ['a']],
    ])
    expect(findConflicts(bindings)).toEqual([['add', 'reveal']])
  })
})

describe('saltos relativos de columna', () => {
  it('liga ⌘← y ⌘→ a los comandos de columna', () => {
    const b = resolveBindings()
    expect(b.get('focus-column-prev')).toEqual(['mod', 'left'])
    expect(b.get('focus-column-next')).toEqual(['mod', 'right'])
  })

  // Sin esto el salto no tiene vuelta desde un campo: sus destinos son la caja de búsqueda
  // de Discogs y los campos del editor, así que un guardián de tecleo dejaría atrapado
  // dentro sin forma de volver con el mismo atajo.
  it('dispara aunque haya un campo enfocado', () => {
    const b = resolveBindings()
    expect(matchChord(b, ['mod', 'left'], false, null)).toBe('focus-column-prev')
    expect(matchChord(b, ['mod', 'left'], true, null)).toBe('focus-column-prev')
    expect(matchChord(b, ['mod', 'right'], true, null)).toBe('focus-column-next')
  })

  it('no entra en conflicto con ningún otro atajo por defecto', () => {
    expect(findConflicts(resolveBindings())).toEqual([])
  })
})
