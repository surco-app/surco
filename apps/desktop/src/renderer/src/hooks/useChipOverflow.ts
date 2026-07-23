import { type RefObject, useLayoutEffect, useRef, useState } from 'react'
import { computeVisibleChips } from '../lib/chipOverflow'

// gap-1.5 de la fila de chips, en px. Si la clase Tailwind cambia, esto debe cambiar con ella.
const CHIP_GAP_PX = 6

interface ChipOverflow {
  containerRef: RefObject<HTMLSpanElement | null>
  measureRef: RefObject<HTMLSpanElement | null>
  visibleCount: number
}

// Cuántos chips de sugerencias caben en la fila colapsada sin salirse de su línea. Una
// fila gemela oculta (measureRef) renderiza todos los chips más una sonda "+N" como último
// hijo; de ahí salen los anchos reales — exactos con cualquier fuente, padding o idioma —
// y computeVisibleChips decide el corte. Se re-mide antes del paint cuando cambian las
// sugerencias (un match de Discogs que llega tarde) y vía ResizeObserver cuando el
// contenedor cambia de ancho (redimensionar la ventana, plegar un panel). El observer va
// con guarda porque jsdom no lo implementa; ahí el contenedor mide 0 y el corte degrada a
// "todos visibles" — ningún chip desaparece por una medida que no existe. Con enabled
// false (fila expandida) no hay nada que cortar ni que medir.
export function useChipOverflow(suggestions: string[], enabled: boolean): ChipOverflow {
  const containerRef = useRef<HTMLSpanElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const [visibleCount, setVisibleCount] = useState(suggestions.length)

  useLayoutEffect(() => {
    if (!enabled || suggestions.length === 0) return
    function measure(): void {
      const container = containerRef.current
      const row = measureRef.current
      if (!container || !row) return
      const children = Array.from(row.children) as HTMLElement[]
      const probe = children.pop()
      setVisibleCount(
        computeVisibleChips(
          children.map((c) => c.getBoundingClientRect().width),
          probe?.getBoundingClientRect().width ?? 0,
          container.getBoundingClientRect().width,
          CHIP_GAP_PX,
        ),
      )
    }
    measure()
    if (typeof ResizeObserver === 'undefined' || !containerRef.current) return
    const ro = new ResizeObserver(measure)
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [suggestions, enabled])

  return { containerRef, measureRef, visibleCount: enabled ? visibleCount : suggestions.length }
}
