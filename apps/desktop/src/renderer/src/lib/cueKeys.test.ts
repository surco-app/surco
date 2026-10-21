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

  it('leaves the list keys to the track list, since each track keeps its unsaved cues', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])
      expect(press(key)).toBeNull()
    expect(press('ArrowDown', { shiftKey: true })).toBeNull()
    for (const mod of ['metaKey', 'ctrlKey']) {
      expect(press('ArrowUp', { [mod]: true })).toBeNull()
      expect(press('ArrowDown', { [mod]: true })).toBeNull()
    }
  })

  it('swallows the chords that leave the editor or remove, process or clear the track under it', () => {
    for (const mod of ['metaKey', 'ctrlKey'])
      for (const key of ['ArrowLeft', 'ArrowRight'])
        expect(press(key, { [mod]: true })).toEqual({ type: 'swallow' })
    expect(press('Backspace', { metaKey: true })).toEqual({ type: 'swallow' })
    expect(press('Enter', { metaKey: true })).toEqual({ type: 'swallow' })
    expect(press('e', { metaKey: true })).toEqual({ type: 'swallow' })
    expect(press('E', { ctrlKey: true })).toEqual({ type: 'swallow' })
    expect(press('Enter', { metaKey: true, shiftKey: true })).toEqual({ type: 'swallow' })
    expect(press('t', { metaKey: true })).toEqual({ type: 'swallow' })
    expect(press('Backspace', { metaKey: true, shiftKey: true })).toBeNull()
  })

  it('marks the point at the playhead with Enter, as the Marcar aquí button does', () => {
    expect(press('Enter')).toEqual({ type: 'mark' })
  })

  it('lets Escape, Tab and every command chord but undo and redo through', () => {
    for (const key of ['Escape', 'Tab', 'F10']) expect(press(key)).toBeNull()
    expect(press('k', { metaKey: true })).toBeNull()
    expect(press(',', { metaKey: true })).toBeNull()
    expect(press('z', { metaKey: true, shiftKey: true })).toEqual({ type: 'redo' })
    expect(press('Z', { metaKey: true, shiftKey: true })).toEqual({ type: 'redo' })
    expect(press('m', { altKey: true })).toBeNull()
  })
})
