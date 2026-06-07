import { describe, expect, it } from 'vitest'
import { isTypingTarget, keyToCommandId, moveIndex } from './keymap'

function key(
  k: string,
  mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {},
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
    expect(keyToCommandId(key('o', { metaKey: true }), false)).toBe('add')
    expect(keyToCommandId(key(',', { metaKey: true }), false)).toBe('settings')
  })

  it('processes the whole queue on cmd+shift+enter', () => {
    expect(keyToCommandId(key('Enter', { metaKey: true, shiftKey: true }), false)).toBe(
      'process-all',
    )
  })

  // ⌘⇧R opens the file-name builder even while a field is focused (it's a modifier
  // combo, not a bare letter), and the shift keeps it distinct from ⌘R (Reveal).
  it('opens the file-name builder on cmd+shift+r, with or without a focused field', () => {
    expect(keyToCommandId(key('r', { metaKey: true, shiftKey: true }), false)).toBe('rename')
    expect(keyToCommandId(key('R', { metaKey: true, shiftKey: true }), true)).toBe('rename')
    expect(keyToCommandId(key('r', { metaKey: true }), false)).toBeNull()
  })

  it('plays the current track on space, but never while typing in a field', () => {
    expect(keyToCommandId(key(' '), false)).toBe('play')
    expect(keyToCommandId(key(' '), true)).toBeNull()
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

describe('isTypingTarget', () => {
  it('treats text inputs and textareas as typing so their keystrokes are theirs', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true)
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true)
  })

  // The album-match dropdown is a <select>; without this its arrow keys would be
  // hijacked by the global next/prev navigation and never reach the options.
  it('treats a <select> as typing so its own arrow/space keys are not stolen', () => {
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true)
  })

  it('treats contenteditable elements as typing', () => {
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })

  it('is not typing for plain elements or nothing focused', () => {
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false)
    expect(isTypingTarget({ tagName: 'DIV' })).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})
