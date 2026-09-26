import { describe, expect, it } from 'vitest'
import { foldAccents } from './foldAccents'

describe('foldAccents', () => {
  it('finds a track by the plain letters a NAS search box is typed with', () => {
    expect(foldAccents('Röyksopp - Fiësta (René Walther Remix) [Contraseña]')).toBe(
      'Royksopp - Fiesta (Rene Walther Remix) [Contrasena]',
    )
  })

  it('folds a decomposed name the same as a composed one, since the disk may hand either', () => {
    expect(foldAccents('José'.normalize('NFD'))).toBe('Jose')
    expect(foldAccents('José'.normalize('NFC'))).toBe('Jose')
  })

  it('spells out the Latin letters that carry no separable accent', () => {
    expect(foldAccents('Trentemøller Ørsted Straße Æon Œuvre Łódź')).toBe(
      'Trentemoller Orsted Strasse AEon OEuvre Lodz',
    )
  })

  it('keeps names in other scripts, which have no plain-letter spelling to fall back to', () => {
    expect(foldAccents('坂本龍一 - Мой Кино')).toBe('坂本龍一 - Мой Кино')
  })
})
