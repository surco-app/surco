import { describe, expect, it } from 'vitest'
import { findConflicts, matchChord, resolveBindings } from './shortcutDefaults'

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
    expect(matchChord(b, ['mod', 'z'], false)).toBeNull()
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
