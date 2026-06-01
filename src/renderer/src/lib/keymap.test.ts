import { describe, it, expect } from 'vitest'
import { moveIndex, keyToCommandId } from './keymap'

function key(
  k: string,
  mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}
): { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean } {
  return { key: k, metaKey: false, ctrlKey: false, shiftKey: false, ...mods }
}

describe('moveIndex', () => {
  it('returns -1 for an empty list so the caller skips selection', () => {
    expect(moveIndex(0, -1, 1)).toBe(-1)
  })

  it('selects the first item when nothing is selected yet', () => {
    expect(moveIndex(3, -1, 1)).toBe(0)
    expect(moveIndex(3, -1, -1)).toBe(0)
  })

  it('clamps at both ends so navigation never wraps or overflows', () => {
    expect(moveIndex(3, 0, -1)).toBe(0)
    expect(moveIndex(3, 2, 1)).toBe(2)
    expect(moveIndex(3, 1, 1)).toBe(2)
    expect(moveIndex(3, 1, -1)).toBe(0)
  })
})

describe('keyToCommandId', () => {
  it('maps the modifier shortcuts to their commands', () => {
    expect(keyToCommandId(key('Enter', { metaKey: true }), false)).toBe('process-current')
    expect(keyToCommandId(key('Enter', { metaKey: true, shiftKey: true }), false)).toBe('process-all')
    expect(keyToCommandId(key('o', { metaKey: true }), false)).toBe('add')
    expect(keyToCommandId(key(',', { metaKey: true }), false)).toBe('settings')
  })

  it('navigates the list with arrows or j/k only when not typing', () => {
    expect(keyToCommandId(key('ArrowDown'), false)).toBe('next')
    expect(keyToCommandId(key('j'), false)).toBe('next')
    expect(keyToCommandId(key('ArrowUp'), false)).toBe('prev')
    expect(keyToCommandId(key('k'), false)).toBe('prev')
    expect(keyToCommandId(key('/'), false)).toBe('search')
  })

  it('ignores navigation keys while typing so the field keeps the keystroke', () => {
    expect(keyToCommandId(key('j'), true)).toBeNull()
    expect(keyToCommandId(key('ArrowDown'), true)).toBeNull()
    expect(keyToCommandId(key('/'), true)).toBeNull()
  })

  it('removes the track on ⌘⌫ only when not typing, so editing a field is safe', () => {
    expect(keyToCommandId(key('Backspace', { metaKey: true }), false)).toBe('remove')
    expect(keyToCommandId(key('Backspace', { metaKey: true }), true)).toBeNull()
  })

  it('returns null for unmapped keys', () => {
    expect(keyToCommandId(key('x'), false)).toBeNull()
  })
})
