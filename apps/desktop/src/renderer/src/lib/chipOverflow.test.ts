import { describe, expect, it } from 'vitest'
import { computeVisibleChips } from './chipOverflow'

// WHY: el corte de los chips de sugerencias dejó de ser fijo (SUGGESTION_PREVIEW=2) y pasó
// a medirse; toda la aritmética del corte vive aquí, sin DOM, para que el caso "+N salta
// a una segunda línea" no pueda volver por un error de cuentas.
describe('computeVisibleChips', () => {
  it('muestra todos los chips sin +N cuando caben', () => {
    // 50+6+50+6+50 = 162 ≤ 200
    expect(computeVisibleChips([50, 50, 50], 30, 200, 6)).toBe(3)
  })

  it('corta en el mayor prefijo que deja hueco al +N', () => {
    // total 338 > 260; k=2: 80+6+80+6+30 = 202 ≤ 260; k=3: 288 > 260
    expect(computeVisibleChips([80, 80, 80, 80], 30, 260, 6)).toBe(2)
  })

  it('cuenta el gap entre el último chip visible y el +N', () => {
    // k=2 necesita exactamente 80+6+80+6+30 = 202
    expect(computeVisibleChips([80, 80, 80], 30, 201, 6)).toBe(1)
    expect(computeVisibleChips([80, 80, 80], 30, 202, 6)).toBe(2)
  })

  it('nunca oculta todos: al menos 1 chip aunque desborde', () => {
    expect(computeVisibleChips([300, 100], 30, 100, 6)).toBe(1)
  })

  it('trata contenedor de ancho 0 como sin medida y muestra todo', () => {
    expect(computeVisibleChips([80, 80, 80], 30, 0, 6)).toBe(3)
  })

  it('devuelve 0 sin chips', () => {
    expect(computeVisibleChips([], 30, 200, 6)).toBe(0)
  })
})
