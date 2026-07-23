// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChipOverflow } from './useChipOverflow'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// jsdom no hace layout: todo getBoundingClientRect mide 0. Para ejercitar el corte real
// se inyectan medidas — el contenedor por su marca data-measure, cualquier otro elemento
// (los chips de la fila de medición) con un ancho fijo por chip.
function mockWidths(containerWidth: number, chipWidth: number): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const width = this.dataset.measure === 'container' ? containerWidth : chipWidth
    return {
      width,
      height: 0,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      toJSON: () => ({}),
    } as DOMRect
  })
}

function Harness({
  suggestions,
  enabled,
}: {
  suggestions: string[]
  enabled: boolean
}): React.JSX.Element {
  const { containerRef, measureRef, visibleCount } = useChipOverflow(suggestions, enabled)
  return (
    <span ref={containerRef} data-measure="container">
      <output data-testid="count">{visibleCount}</output>
      <span ref={measureRef}>
        {suggestions.map((s) => (
          <span key={s}>{s}</span>
        ))}
        <span>+{suggestions.length - 1}</span>
      </span>
    </span>
  )
}

// WHY: el hook es el puente entre el DOM medido y computeVisibleChips; estos tests fijan
// que mide lo que debe (hijos de la fila oculta, sonda +N aparte, ancho del contenedor)
// y que reacciona a los cambios que el ResizeObserver no cubre en jsdom.
describe('useChipOverflow', () => {
  it('corta según las medidas reales del contenedor y los chips', () => {
    // chips de 80, sonda +N de 80, contenedor 260: k=2 → 80+6+80+6+80 = 252 ≤ 260; k=3 → 338
    mockWidths(260, 80)
    render(<Harness suggestions={['a', 'b', 'c', 'd']} enabled />)
    expect(screen.getByTestId('count')).toHaveTextContent('2')
  })

  it('re-mide cuando cambian las sugerencias bajo un campo montado', () => {
    mockWidths(260, 80)
    const { rerender } = render(<Harness suggestions={['a', 'b', 'c', 'd']} enabled />)
    expect(screen.getByTestId('count')).toHaveTextContent('2')
    // Con 3 chips de 80 caben todos (80*3 + 6*2 = 252 ≤ 260): el corte desaparece.
    rerender(<Harness suggestions={['a', 'b', 'c']} enabled />)
    expect(screen.getByTestId('count')).toHaveTextContent('3')
  })

  it('sin medida fiable (ancho 0) muestra todos', () => {
    render(<Harness suggestions={['a', 'b', 'c', 'd']} enabled />)
    expect(screen.getByTestId('count')).toHaveTextContent('4')
  })

  it('deshabilitado (expandido) devuelve todos sin medir', () => {
    mockWidths(260, 80)
    render(<Harness suggestions={['a', 'b', 'c', 'd']} enabled={false} />)
    expect(screen.getByTestId('count')).toHaveTextContent('4')
  })
})
