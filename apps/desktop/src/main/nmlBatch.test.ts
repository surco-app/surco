// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { recordNmlPatch, resetNmlPatches, takeNmlPatches } from './nmlBatch'

const patch = (file: string) => ({ volume: 'HD', dir: '/:M:/', file })

beforeEach(() => resetNmlPatches())

describe('nmlBatch', () => {
  // Un lote de 300 pistas debe producir UNA escritura del NML, no 300: el fichero
  // es la colección entera y puede pesar decenas de MB.
  it('collects the patches of a batch and hands them over at once', () => {
    recordNmlPatch(patch('uno.aiff'))
    recordNmlPatch(patch('dos.aiff'))

    expect(takeNmlPatches()).toHaveLength(2)
  })

  // Tomar el lote lo vacía: un segundo volcado no puede reescribir el NML con los
  // patches del lote anterior, que ya se aplicaron.
  it('empties itself once taken', () => {
    recordNmlPatch(patch('uno.aiff'))
    takeNmlPatches()

    expect(takeNmlPatches()).toEqual([])
  })

  // Un lote nuevo empieza limpio aunque el anterior acabara a medias (cancelado,
  // fallado): un patch huérfano se aplicaría a destiempo sobre la colección.
  it('starts clean after a reset', () => {
    recordNmlPatch(patch('uno.aiff'))
    resetNmlPatches()

    expect(takeNmlPatches()).toEqual([])
  })
})
