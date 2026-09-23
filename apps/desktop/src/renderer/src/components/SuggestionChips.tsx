import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChipOverflow } from '../hooks/useChipOverflow'

interface SuggestionChipsProps {
  suggestions: string[]
  isOn: (s: string) => boolean
  isPartial?: (s: string) => boolean
  onPick: (s: string) => void
  scope?: string
  dim?: boolean
}

// Suggestion chips collapse to the first few + a "+N" chip so a long list (a genre with
// ten Discogs styles) doesn't push the form down; clicking "+N" reveals the rest.
export function SuggestionChips({
  suggestions,
  isOn,
  isPartial,
  onPick,
  scope,
  dim,
}: SuggestionChipsProps): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [chipsExpanded, setChipsExpanded] = useState(false)
  const firstRevealedRef = useRef<HTMLButtonElement>(null)
  const revealFromRef = useRef<number | null>(null)
  const { containerRef, measureRef, visibleCount } = useChipOverflow(
    suggestions,
    !chipsExpanded && suggestions.length > 0,
  )
  // Pressing "+N" unmounts it, so focus would fall to the body. Land it on the first chip
  // the expansion revealed, which is where the keyboard user was heading anyway.
  useEffect(() => {
    if (!chipsExpanded || revealFromRef.current === null) return
    revealFromRef.current = null
    firstRevealedRef.current?.focus()
  }, [chipsExpanded])
  return (
    <span
      ref={containerRef}
      data-testid={scope ? `field-suggestions-${scope}` : 'field-suggestions'}
      // Colapsada, la fila es UNA línea pase lo que pase: nowrap + overflow-hidden, y el
      // corte medido (useChipOverflow) decide cuántos chips entran dejando hueco al "+N" —
      // el corte fijo de antes saltaba a una segunda línea en columnas estrechas y
      // desperdiciaba hueco en las anchas. Expandida vuelve al wrap multilínea.
      className={`relative flex items-center gap-1.5 ${dim ? 'mt-1' : 'mt-1.5'} ${
        chipsExpanded ? 'flex-wrap' : 'flex-nowrap overflow-hidden'
      }`}
    >
      {(chipsExpanded ? suggestions : suggestions.slice(0, visibleCount)).map((s, i) => {
        const state = isOn(s) ? 'on' : isPartial?.(s) ? 'some' : 'off'
        return (
          <button
            key={s}
            ref={i === revealFromRef.current ? firstRevealedRef : undefined}
            type="button"
            data-testid={scope ? `chip-${scope}-${s}` : `chip-${s}`}
            data-state={state}
            aria-pressed={state === 'on' ? true : state === 'some' ? 'mixed' : false}
            onClick={() => onPick(s)}
            // Colapsado, el chip puede encoger y truncar con elipsis — solo pasa en el caso
            // mínimo-1 (ni un chip cabe entero); si el corte dice que cabe, no encoge nada.
            className={`press rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
              chipsExpanded ? 'shrink-0' : 'min-w-0 truncate'
            } ${
              state === 'on'
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-fg'
                : state === 'some'
                  ? 'border-dashed border-[color-mix(in_srgb,var(--color-accent)_60%,transparent)] text-[var(--color-accent)]'
                  : dim
                    ? 'border-[var(--color-line)] text-fg-faint hover:bg-[var(--color-panel-2)]'
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
          onClick={() => {
            revealFromRef.current = visibleCount
            setChipsExpanded(true)
          }}
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
