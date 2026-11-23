import { describe, expect, it } from 'vitest'
import i18n from './index'

describe('a count inside a sentence', () => {
  it('groups its thousands like the counters around it, so "1000 tracks" never sits beside "1.000"', async () => {
    await i18n.changeLanguage('es')
    expect(i18n.t('editor.editingMultiple', { count: 1000 })).toBe('Editando 1.000 pistas')
    expect(i18n.t('editor.editingMultiple', { count: 12345 })).toBe('Editando 12.345 pistas')
    await i18n.changeLanguage('en')
    expect(i18n.t('editor.editingMultiple', { count: 12345 })).toBe('Editing 12,345 tracks')
  })

  it('still picks the plural from the number itself', async () => {
    await i18n.changeLanguage('es')
    expect(i18n.t('common.scopeSelected', { count: 1 })).toBe('Se aplica a 1 pista seleccionada')
    expect(i18n.t('common.scopeSelected', { count: 1000 })).toBe(
      'Se aplica a las 1.000 pistas seleccionadas',
    )
    await i18n.changeLanguage('en')
  })

  it('groups the other tallies a sentence counts with, such as how many of a selection are ready', async () => {
    await i18n.changeLanguage('es')
    expect(i18n.t('header.convertSomeSelected', { ready: 751, total: 1000 })).toBe(
      'Convertir 751 de 1.000 seleccionadas',
    )
    await i18n.changeLanguage('en')
  })

  it('leaves every other number as it is, since a year or a bitrate is not a tally', () => {
    expect(i18n.t('x {{year}}', { year: 2026 })).toBe('x 2026')
  })
})
