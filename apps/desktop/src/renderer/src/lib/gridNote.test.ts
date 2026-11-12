import { beforeAll, describe, expect, it } from 'vitest'
import type { GridCheck } from '../../../shared/gridCheck'
import type { GridVerdict } from '../../../shared/gridVerdict'
import i18n from '../i18n'
import { gridNote } from './gridNote'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

const withVerdict = (verdict: GridVerdict): GridCheck => ({
  hereMs: 0,
  endMs: 0,
  worstMs: 0,
  verdict,
})

describe('gridNote', () => {
  const tr = i18n.t.bind(i18n)

  it('says which way the grid is off and by how much, as the DJ checked Snow On The Sahara', () => {
    expect(gridNote(withVerdict({ kind: 'shifted', ms: -92 }), tr, 'es')).toEqual({
      text: '−92 ms',
      title: 'Rejilla 92 ms adelantada',
    })
    expect(gridNote(withVerdict({ kind: 'shifted', ms: 31 }), tr, 'es')).toEqual({
      text: '+31 ms',
      title: 'Rejilla 31 ms retrasada',
    })
  })

  it('says a drifting grid moves a few ms a minute, the way Execute Base opens up', () => {
    expect(gridNote(withVerdict({ kind: 'drifting', msPerMin: -7.5 }), tr, 'es')).toEqual({
      text: '−7,5 ms/min',
      title: 'La rejilla se adelanta 7,5 ms por minuto',
    })
    expect(gridNote(withVerdict({ kind: 'drifting', msPerMin: 4 }), tr, 'es')).toEqual({
      text: '+4 ms/min',
      title: 'La rejilla se retrasa 4 ms por minuto',
    })
  })

  it('notes a 102 ms shift the old verdict could not see', () => {
    expect(gridNote({ hereMs: 40, endMs: 102, worstMs: 102, verdict: null }, tr, 'es')).toEqual({
      text: '+102 ms',
      title: 'Rejilla 102 ms retrasada',
    })
    expect(gridNote({ hereMs: -102, endMs: 30, worstMs: 102, verdict: null }, tr, 'es')).toEqual({
      text: '−102 ms',
      title: 'Rejilla 102 ms adelantada',
    })
  })
})
