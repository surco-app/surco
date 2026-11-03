import { beforeAll, describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { gridNote } from './gridNote'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

describe('gridNote', () => {
  const tr = i18n.t.bind(i18n)

  it('says which way the grid is off and by how much, as the DJ checked Snow On The Sahara', () => {
    expect(gridNote({ kind: 'shifted', ms: -92 }, tr, 'es')).toBe('Rejilla 92 ms adelantada')
    expect(gridNote({ kind: 'shifted', ms: 31 }, tr, 'es')).toBe('Rejilla 31 ms retrasada')
  })

  it('says a drifting grid moves a few ms a minute, the way Execute Base opens up', () => {
    expect(gridNote({ kind: 'drifting', msPerMin: -7.5 }, tr, 'es')).toBe(
      'La rejilla se adelanta 7,5 ms por minuto',
    )
    expect(gridNote({ kind: 'drifting', msPerMin: 4 }, tr, 'es')).toBe(
      'La rejilla se retrasa 4 ms por minuto',
    )
  })
})
