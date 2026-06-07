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

  // Mod-combos still fire while typing (so ⌘⏎ converts mid-edit), but bare keys don't
  // (so Space types a space) and ⌘⌫ is suppressed (so ⌫ deletes text, not the track).
  it('applies the typing guard: mod-combos fire, bare keys and ⌘⌫ do not', () => {
    expect(matchChord(b, ['mod', 'enter'], true)).toBe('process-current')
    expect(matchChord(b, ['space'], true)).toBeNull()
    expect(matchChord(b, ['space'], false)).toBe('play')
    expect(matchChord(b, ['mod', 'backspace'], true)).toBeNull()
    expect(matchChord(b, ['mod', 'backspace'], false)).toBe('remove')
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
