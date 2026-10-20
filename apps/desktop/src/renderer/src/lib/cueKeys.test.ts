import { describe, expect, it } from 'vitest'
import { cueKeyAction } from './cueKeys'

const press = (
  key: string,
  mods: Partial<Record<'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {},
) => cueKeyAction({ key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...mods })

describe('cueKeyAction', () => {
  it('maps the keys of the spec table', () => {
    expect(press(' ')).toEqual({ type: 'play' })
    expect(press('ArrowRight')).toEqual({ type: 'jump', dir: 1 })
    expect(press('ArrowLeft')).toEqual({ type: 'jump', dir: -1 })
    expect(press('ArrowRight', { shiftKey: true })).toEqual({ type: 'beat', dir: 1 })
    expect(press('ArrowLeft', { shiftKey: true })).toEqual({ type: 'beat', dir: -1 })
    expect(press('c')).toEqual({ type: 'centre' })
    expect(press('C', { shiftKey: true })).toEqual({ type: 'centre' })
    expect(press('m')).toEqual({ type: 'memory' })
    expect(press('Backspace')).toEqual({ type: 'remove' })
    expect(press('Delete')).toEqual({ type: 'remove' })
    expect(press('z', { metaKey: true })).toEqual({ type: 'undo' })
    expect(press('z', { ctrlKey: true })).toEqual({ type: 'undo' })
    expect(press('+')).toEqual({ type: 'zoom', dir: 'in' })
    expect(press('=')).toEqual({ type: 'zoom', dir: 'in' })
    expect(press('-')).toEqual({ type: 'zoom', dir: 'out' })
  })

  it('sends 1 to 8 to rekordbox letters A to H', () => {
    expect(['1', '2', '3', '4', '5', '6', '7', '8'].map((k) => press(k))).toEqual(
      [1, 2, 3, 5, 6, 7, 8, 9].map((kind) => ({ type: 'hot', kind })),
    )
  })

  it('swallows every other bare letter or digit so nothing hidden acts under the editor', () => {
    for (const key of ['q', 'w', 'a', 'z', 's', '9', '0'])
      expect(press(key)).toEqual({ type: 'swallow' })
  })

  it('swallows every other single character, so a symbol bound to Trim never moves a hidden cut', () => {
    for (const key of ['.', ',', '/', ';', "'", '[', 'ñ', 'Q'])
      expect(press(key)).toEqual({ type: 'swallow' })
  })

  it('swallows the list keys, which would change track and drop the unsaved cues', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])
      expect(press(key)).toEqual({ type: 'swallow' })
    expect(press('ArrowDown', { shiftKey: true })).toEqual({ type: 'swallow' })
  })

  it('lets Escape, Tab, Enter and every command chord but undo through', () => {
    for (const key of ['Escape', 'Tab', 'Enter', 'F10']) expect(press(key)).toBeNull()
    expect(press('k', { metaKey: true })).toBeNull()
    expect(press(',', { metaKey: true })).toBeNull()
    expect(press('z', { metaKey: true, shiftKey: true })).toBeNull()
    expect(press('m', { altKey: true })).toBeNull()
  })
})
