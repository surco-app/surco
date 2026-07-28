import { describe, expect, it } from 'vitest'
import { detectTraktorNmlPaths } from './traktorNmlPath'

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
