import { describe, expect, it } from 'vitest'
import { type KeyLike, chordEquals, chordToAccelerator, eventToChord } from './shortcuts'

function key(k: string, mods: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike {
  return { key: k, metaKey: false, ctrlKey: false, shiftKey: false, ...mods }
}

describe('eventToChord', () => {
  // Letters keep shift as a real modifier and lowercase the token, so ⌘⇧R (rename)
  // stays distinct from ⌘R (reveal) — the whole reason both can be bound.
  it('keeps shift as a modifier for letters and named keys', () => {
    expect(eventToChord(key('R', { metaKey: true, shiftKey: true }), true)).toEqual([
      'mod',
      'shift',
      'r',
    ])
    expect(eventToChord(key('r', { metaKey: true }), true)).toEqual(['mod', 'r'])
    expect(eventToChord(key('Enter', { metaKey: true, shiftKey: true }), true)).toEqual([
      'mod',
      'shift',
      'enter',
    ])
  })

  // A shifted symbol encodes its own shift (the event arrives as '?', not '/'+shift),
  // so storing ['shift','?'] would never match — drop the shift token.
  it('drops the shift token for printable shifted symbols', () => {
    expect(eventToChord(key('?', { shiftKey: true }), true)).toEqual(['?'])
  })

  it('maps named and symbol keys to their tokens', () => {
    expect(eventToChord(key(' '), true)).toEqual(['space'])
    expect(eventToChord(key('ArrowDown'), true)).toEqual(['down'])
    expect(eventToChord(key('ArrowUp'), true)).toEqual(['up'])
    expect(eventToChord(key('/'), true)).toEqual(['/'])
    expect(eventToChord(key(',', { metaKey: true }), true)).toEqual(['mod', ','])
  })

  // `mod` is platform-correct: ⌘ on mac, Ctrl elsewhere. So Ctrl on mac (or ⌘ off mac)
  // is NOT a mod — this is the deliberate tightening from the old metaKey||ctrlKey.
  it('treats mod as ⌘ on mac and Ctrl elsewhere, not both', () => {
    expect(eventToChord(key('o', { ctrlKey: true }), false)).toEqual(['mod', 'o'])
    expect(eventToChord(key('o', { metaKey: true }), false)).toEqual(['o'])
    expect(eventToChord(key('o', { ctrlKey: true }), true)).toEqual(['o'])
  })

  it('returns null for keys we never bind', () => {
    expect(eventToChord(key('Tab'), true)).toBeNull()
    expect(eventToChord(key('F1'), true)).toBeNull()
  })
})

describe('chordToAccelerator', () => {
  it('renders Electron accelerator strings from a chord', () => {
    expect(chordToAccelerator(['mod', 'shift', 'r'])).toBe('CmdOrCtrl+Shift+R')
    expect(chordToAccelerator(['mod', 'r'])).toBe('CmdOrCtrl+R')
    expect(chordToAccelerator(['mod', 'backspace'])).toBe('CmdOrCtrl+Backspace')
    expect(chordToAccelerator(['mod', ','])).toBe('CmdOrCtrl+,')
    expect(chordToAccelerator(['space'])).toBe('Space')
    expect(chordToAccelerator(['down'])).toBe('Down')
  })
})

describe('chordEquals', () => {
  it('is true only for the same tokens in the same order', () => {
    expect(chordEquals(['mod', 'r'], ['mod', 'r'])).toBe(true)
    expect(chordEquals(['mod', 'r'], ['mod', 'shift', 'r'])).toBe(false)
    expect(chordEquals(['mod', 'r'], ['r', 'mod'])).toBe(false)
  })
})
