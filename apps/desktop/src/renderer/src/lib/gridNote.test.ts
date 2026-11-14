import { beforeAll, describe, expect, it } from 'vitest'
import type { GridCheck } from '../../../shared/gridAudit'
import i18n from '../i18n'
import { gridNote } from './gridNote'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})

const measured = (medianMs: number, sustainedMs = medianMs): GridCheck => ({
  kind: 'measured',
  medianMs,
  sustainedMs,
})

describe('gridNote', () => {
  const tr = i18n.t.bind(i18n)

  it('says which way the grid is off and by how much, as the DJ checked Snow On The Sahara', () => {
    expect(gridNote(measured(92), 10, tr, 'es')).toEqual({
      text: '−92 ms',
      title: 'Rejilla 92 ms adelantada',
    })
    expect(gridNote(measured(-31), 10, tr, 'es')).toEqual({
      text: '+31 ms',
      title: 'Rejilla 31 ms retrasada',
    })
  })

  it('says when the grid is off only in part of the track, the way Execute Base opens up', () => {
    expect(gridNote(measured(2, -18), 10, tr, 'es')).toEqual({
      text: '+18 ms',
      title: 'Rejilla 18 ms retrasada en parte del tema',
    })
    expect(gridNote(measured(-3, 16), 10, tr, 'es')).toEqual({
      text: '−16 ms',
      title: 'Rejilla 16 ms adelantada en parte del tema',
    })
  })

  it('says the grid tempo does not match when the beat smears across its beats, like El Exorcista', () => {
    expect(gridNote({ kind: 'tempo' }, 10, tr, 'es')).toEqual({
      text: 'BPM',
      title: 'El BPM de la rejilla no encaja con el audio',
    })
  })
})
