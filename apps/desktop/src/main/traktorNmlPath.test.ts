import { describe, expect, it } from 'vitest'
import { detectTraktorNmlPaths, followTraktorVersion, traktorInUse } from './traktorNmlPath'

describe('detectTraktorNmlPaths', () => {
  // Traktor crea una carpeta por versión y la ruta cambia al actualizar. Se propone
  // la más nueva, pero se devuelven todas: el usuario puede tener varias y saber
  // cuál usa de verdad.
  it('proposes the newest Traktor version first', () => {
    const dirs = ['Traktor 4.4.1', 'Traktor 4.5.0', 'Traktor 4.4.2']

    const found = detectTraktorNmlPaths('/Users/dj', () => dirs)

    expect(found[0]).toContain('Traktor 4.5.0')
    expect(found).toHaveLength(3)
  })

  // Comparación por número, no alfabética: "4.10" es posterior a "4.9" aunque
  // ordene antes como texto.
  it('orders versions numerically, not lexically', () => {
    const found = detectTraktorNmlPaths('/Users/dj', () => ['Traktor 4.9.0', 'Traktor 4.10.0'])

    expect(found[0]).toContain('Traktor 4.10.0')
  })

  // Sin Traktor instalado no hay nada que proponer, y no es un error: el usuario
  // elegirá su .nml a mano si lo tiene fuera del sitio estándar.
  it('finds nothing when there is no Traktor folder', () => {
    expect(detectTraktorNmlPaths('/Users/dj', () => [])).toEqual([])
  })
})

const NI = '/Users/dj/Documents/Native Instruments'
const nml = (version: string) => `${NI}/Traktor ${version}/collection.nml`
const tsi = (version: string) => `${NI}/Traktor ${version}/Traktor Settings.tsi`

describe('traktorInUse', () => {
  // Un usuario con 3.4.0, 3.5.3, 4.0.2 y 4.4.0 usaba la 4.0.2: la versión más alta no dice
  // cuál abre Traktor. Lo dice la configuración que Traktor guarda al cerrarse, que Surco
  // nunca toca (la fecha de collection.nml sí la mueve Surco al escribir).
  it('picks the folder whose Traktor settings were saved last, not the newest version', () => {
    const dates: Record<string, number> = {
      [nml('4.0.2')]: 1,
      [nml('4.4.0')]: 9,
      [tsi('4.0.2')]: 500,
      [tsi('4.4.0')]: 100,
    }
    expect(traktorInUse([nml('4.4.0'), nml('4.0.2')], (p) => dates[p] ?? null)).toBe(nml('4.0.2'))
  })

  it('skips a folder without a collection', () => {
    const dates: Record<string, number> = {
      [nml('4.0.2')]: 1,
      [tsi('4.4.0')]: 900,
      [tsi('4.0.2')]: 5,
    }
    expect(traktorInUse([nml('4.4.0'), nml('4.0.2')], (p) => dates[p] ?? null)).toBe(nml('4.0.2'))
  })

  it('says nothing when no folder carries Traktor settings', () => {
    expect(traktorInUse([nml('4.4.0')], (p) => (p === nml('4.4.0') ? 1 : null))).toBeNull()
  })
})

describe('followTraktorVersion', () => {
  const candidates = [nml('4.4.0'), nml('4.0.2')]
  const same = (a: string, b: string) => a === b

  // Cada versión de Traktor lee solo su carpeta: escribir en la de otra versión no llega
  // nunca a Traktor, y lo hacía en silencio tras cada actualización.
  it('moves a collection in a version folder to the one Traktor uses', () => {
    expect(followTraktorVersion(nml('4.4.0'), candidates, nml('4.0.2'), same)).toBe(nml('4.0.2'))
  })

  // Hay DJs con la colección fuera de Documentos (iCloud): esa elección es suya y no se toca.
  it('keeps a collection chosen outside the Traktor folders', () => {
    const custom = '/Users/dj/Documentos — Local/collection.nml'
    expect(followTraktorVersion(custom, candidates, nml('4.0.2'), same)).toBe(custom)
  })

  it('keeps the collection when it is not known which one Traktor uses', () => {
    expect(followTraktorVersion(nml('4.4.0'), candidates, null, same)).toBe(nml('4.4.0'))
  })

  it('does not choose a collection for a DJ who has not set Traktor up', () => {
    expect(followTraktorVersion('', candidates, nml('4.0.2'), same)).toBe('')
  })

  // Windows no distingue mayúsculas: C:\Users y c:\users son la misma carpeta.
  it('recognises a version folder written with other capitals', () => {
    const loose = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
    expect(followTraktorVersion(nml('4.4.0').toUpperCase(), candidates, nml('4.0.2'), loose)).toBe(
      nml('4.0.2'),
    )
  })
})
