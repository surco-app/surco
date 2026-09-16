import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChipOverflow } from '../hooks/useChipOverflow'

interface SuggestionChipsProps {
  suggestions: string[]
  isOn: (s: string) => boolean
  onPick: (s: string) => void
}

// Suggestion chips collapse to the first few + a "+N" chip so a long list (a genre with
// ten Discogs styles) doesn't push the form down; clicking "+N" reveals the rest.
export function SuggestionChips({
  suggestions,
  isOn,
  onPick,
}: SuggestionChipsProps): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [chipsExpanded, setChipsExpanded] = useState(false)
  const { containerRef, measureRef, visibleCount } = useChipOverflow(
    suggestions,
    !chipsExpanded && suggestions.length > 0,
  )
  return (
    <span
      ref={containerRef}
      data-testid="field-suggestions"
      // Colapsada, la fila es UNA línea pase lo que pase: nowrap + overflow-hidden, y el
      // corte medido (useChipOverflow) decide cuántos chips entran dejando hueco al "+N" —
      // el corte fijo de antes saltaba a una segunda línea en columnas estrechas y
      // desperdiciaba hueco en las anchas. Expandida vuelve al wrap multilínea.
      className={`relative mt-1.5 flex items-center gap-1.5 ${
        chipsExpanded ? 'flex-wrap' : 'flex-nowrap overflow-hidden'
      }`}
    >
      {(chipsExpanded ? suggestions : suggestions.slice(0, visibleCount)).map((s) => {
        const on = isOn(s)
        return (
          <button
            key={s}
            type="button"
            data-testid={`chip-${s}`}
            onClick={() => onPick(s)}
            // Colapsado, el chip puede encoger y truncar con elipsis — solo pasa en el caso
            // mínimo-1 (ni un chip cabe entero); si el corte dice que cabe, no encoge nada.
            className={`press rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
              chipsExpanded ? 'shrink-0' : 'min-w-0 truncate'
            } ${
              on
                ? 'border-transparent bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                : 'border-[var(--color-line-strong)] text-fg-muted hover:bg-[var(--color-panel-2)]'
            }`}
          >
            {s}
          </button>
        )
      })}
      {!chipsExpanded && suggestions.length > visibleCount && (
        <button
          type="button"
          data-testid="chip-more"
          onClick={() => setChipsExpanded(true)}
          aria-label={tr('fields.suggestionsMore', {
            count: suggestions.length - visibleCount,
          })}
          className="press shrink-0 rounded-full border border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] px-2 py-0.5 text-[10px] text-[var(--color-accent)] transition-colors hover:bg-[var(--color-panel-2)]"
        >
          +{suggestions.length - visibleCount}
        </button>
      )}
      {!chipsExpanded && (
        // Fila gemela de medición: todos los chips más la sonda "+N" (con el mayor resto
        // posible, el caso más ancho), invisible y fuera del flujo. Debe replicar las clases
        // de tamaño de los chips reales (borde, padding, fuente) o las medidas mienten.
        // Sin testids: duplicaría los selectores chip-* de los chips reales.
        <span
          ref={measureRef}
          aria-hidden="true"
          className="invisible absolute top-0 left-0 flex items-center gap-1.5 whitespace-nowrap"
        >
          {suggestions.map((s) => (
            <span key={s} className="rounded-full border px-2 py-0.5 text-[10px]">
              {s}
            </span>
          ))}
          <span className="rounded-full border px-2 py-0.5 text-[10px]">
            +{suggestions.length - 1}
          </span>
        </span>
      )}
    </span>
  )
}
