import { describe, expect, it } from 'vitest'
import { chordEquals, chordToAccelerator, eventToChord, type KeyLike } from './shortcuts'

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
    expect(eventToChord(key('o', { ctrlKey: true }), true)).toEqual(['ctrl', 'o'])
  })

  it('returns null for keys we never bind', () => {
    expect(eventToChord(key('Tab'), true)).toBeNull()
    expect(eventToChord(key('F1'), true)).toBeNull()
  })

  // Shift+F10 is the track menu's chord (the Windows/Linux convention for a context
  // menu), so F10 must resolve to a token or that chord could never be formed.
  it('recognizes F10 as a bindable key', () => {
    expect(eventToChord(key('F10', { shiftKey: true }), true)).toEqual(['shift', 'f10'])
  })
})

describe('modificadores alt y ctrl', () => {
  // ⌥E en un teclado español produce `´` (carácter muerto), no `e`. Guardar ese carácter
  // ataría el atajo al idioma del sistema, y un teclado de macros manda posiciones, no
  // letras: el mismo hardware se comportaría distinto en otra máquina.
  it('guarda la posición física de la tecla cuando hay alt', () => {
    const chord = eventToChord(
      { key: '´', code: 'KeyE', metaKey: false, ctrlKey: false, altKey: true, shiftKey: false },
      true,
    )
    expect(chord).toEqual(['alt', 'e'])
  })

  // En macOS Control es un modificador libre. Sin leerlo, ⌃E se guardaba como ['e'] y
  // pisaba la tecla suelta de otro comando, en silencio.
  it('reconoce Control en macOS como modificador propio', () => {
    const chord = eventToChord(
      { key: 'e', code: 'KeyE', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
      true,
    )
    expect(chord).toEqual(['ctrl', 'e'])
  })

  // Fuera de macOS Ctrl ES `mod`, así que no puede ser además un modificador aparte.
  it('trata Control como mod fuera de macOS', () => {
    const chord = eventToChord(
      { key: 'e', code: 'KeyE', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
      false,
    )
    expect(chord).toEqual(['mod', 'e'])
  })

  // Orden canónico: sin él, ⌥⇧E y ⇧⌥E serían chords distintos para la misma pulsación y
  // el guardado nunca casaría con lo pulsado.
  it('ordena los modificadores igual sea cual sea el orden de pulsación', () => {
    const chord = eventToChord(
      { key: 'E', code: 'KeyE', metaKey: true, ctrlKey: true, altKey: true, shiftKey: true },
      true,
    )
    expect(chord).toEqual(['mod', 'alt', 'ctrl', 'shift', 'e'])
  })

  // Sin alt ni ctrl nada cambia: los atajos ya guardados están en forma de carácter y
  // tienen que seguir resolviendo igual.
  it('mantiene la forma por carácter cuando no hay alt ni ctrl', () => {
    expect(
      eventToChord(
        { key: 'r', code: 'KeyR', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
        true,
      ),
    ).toEqual(['mod', 'r'])
  })

  // Las teclas con nombre (flechas, Enter…) no dependen de la distribución, así que
  // conservan su token aunque el chord lleve alt.
  it('conserva el token con nombre de las teclas especiales', () => {
    const chord = eventToChord(
      {
        key: 'ArrowLeft',
        code: 'ArrowLeft',
        metaKey: false,
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
      },
      true,
    )
    expect(chord).toEqual(['alt', 'left'])
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
