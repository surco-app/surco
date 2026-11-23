import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChipOverflow } from '../hooks/useChipOverflow'
import { Tooltip } from './Tooltip'

interface SuggestionChipsProps {
  suggestions: string[]
  isOn: (s: string) => boolean
  isPartial?: (s: string) => boolean
  partialLabel?: (s: string) => string
  onPick: (s: string) => void
  scope?: string
  dim?: boolean
  audioDerived?: boolean
  // Names the row so it remembers, across tracks and launches, whether it was left open.
  foldKey?: string
}

// Suggestion chips collapse to the first few + a "+N" chip so a long list (a genre with
// ten Discogs styles) doesn't push the form down; clicking "+N" reveals the rest.
const OPEN_KEY = 'surco.chips.open.'

function leftOpen(foldKey: string | undefined): boolean {
  if (!foldKey) return false
  try {
    return window.localStorage.getItem(OPEN_KEY + foldKey) === '1'
  } catch {
    return false
  }
}

function rememberOpen(foldKey: string | undefined, open: boolean): void {
  if (!foldKey) return
  try {
    if (open) window.localStorage.setItem(OPEN_KEY + foldKey, '1')
    else window.localStorage.removeItem(OPEN_KEY + foldKey)
  } catch {
    return
  }
}

export function SuggestionChips({
  suggestions,
  isOn,
  isPartial,
  partialLabel,
  onPick,
  scope,
  dim,
  audioDerived,
  foldKey,
}: SuggestionChipsProps): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [chipsExpanded, setChipsExpanded] = useState(() => leftOpen(foldKey))
  const setOpen = (open: boolean): void => {
    setChipsExpanded(open)
    rememberOpen(foldKey, open)
  }
  const moreRef = useRef<HTMLButtonElement>(null)
  const [cut, setCut] = useState<string | null>(null)
  const measureCut = (chip: HTMLElement, s: string): void => {
    const name = chip.querySelector<HTMLElement>('[data-chip-name]')
    setCut(name && name.scrollWidth > name.clientWidth ? s : null)
  }
  const foldedByHand = useRef(false)
  const firstRevealedRef = useRef<HTMLButtonElement>(null)
  const revealFromRef = useRef<number | null>(null)
  const stateOf = (s: string) => (isOn(s) ? 'on' : isPartial?.(s) ? 'some' : 'off')
  // Applied tags lead the row so "+N" never stands for one. The order only changes when
  // an applied tag would otherwise be hidden, never on a toggle of a chip in view: a chip
  // that moved when pressed would slide out from under the pointer.
  const listKey = suggestions.join('\n')
  const appliedFirst = (): string[] => [
    ...suggestions.filter((s) => stateOf(s) !== 'off'),
    ...suggestions.filter((s) => stateOf(s) === 'off'),
  ]
  const [lead, setLead] = useState(() => ({ key: listKey, chips: appliedFirst() }))
  if (lead.key !== listKey) setLead({ key: listKey, chips: appliedFirst() })
  const chips = lead.chips
  // Measured open or folded: an open row still has to know how many chips one line holds,
  // to offer the fold only where there is something to fold.
  const { containerRef, measureRef, visibleCount } = useChipOverflow(chips, chips.length > 0)
  const appliedHidden =
    !chipsExpanded && chips.slice(visibleCount).some((s) => stateOf(s) !== 'off')
  if (appliedHidden && lead.key === listKey) {
    const next = appliedFirst()
    if (next.join('\n') !== chips.join('\n')) setLead({ key: listKey, chips: next })
  }
  // With more applied tags than one line holds, the row grows to hold them all, and only
  // them: the rest stay behind "+N", so the form is pushed down by what the track carries
  // and not by every suggestion there is.
  const lastApplied = chips.reduce((last, s, i) => (stateOf(s) !== 'off' ? i : last), -1)
  const foldedCount = Math.max(visibleCount, lastApplied + 1)
  const foldable = chips.length > foldedCount
  const shownCount = chipsExpanded ? chips.length : foldedCount
  const showAll = chipsExpanded || shownCount > visibleCount
  // Pressing "+N" unmounts it, so focus would fall to the body. Land it on the first chip
  // the expansion revealed, which is where the keyboard user was heading anyway.
  useEffect(() => {
    if (!chipsExpanded) {
      if (foldedByHand.current) moreRef.current?.focus()
      foldedByHand.current = false
      return
    }
    if (revealFromRef.current === null) return
    revealFromRef.current = null
    firstRevealedRef.current?.focus()
  }, [chipsExpanded])
  const content = (s: string): React.ReactNode => {
    const state = stateOf(s)
    return (
      <>
        <span data-chip-name className="min-w-0 truncate">
          {s}
        </span>
        {partialLabel && state === 'some' && (
          <span className="ml-1 shrink-0 tabular-nums text-fg-faint">{partialLabel(s)}</span>
        )}
      </>
    )
  }
  return (
    <span
      ref={containerRef}
      data-testid={scope ? `field-suggestions-${scope}` : 'field-suggestions'}
      // Colapsada, la fila es UNA línea pase lo que pase: nowrap + overflow-hidden, y el
      // corte medido (useChipOverflow) decide cuántos chips entran dejando hueco al "+N" —
      // el corte fijo de antes saltaba a una segunda línea en columnas estrechas y
      // desperdiciaba hueco en las anchas. Expandida vuelve al wrap multilínea.
      className={`relative flex items-center gap-1.5 ${dim ? 'mt-1' : 'mt-1.5'} ${
        showAll ? 'flex-wrap' : 'flex-nowrap overflow-hidden'
      }`}
    >
      {chips.slice(0, shownCount).map((s, i) => {
        const state = stateOf(s)
        return (
          <button
            key={s}
            ref={i === revealFromRef.current ? firstRevealedRef : undefined}
            type="button"
            data-testid={scope ? `chip-${scope}-${s}` : `chip-${s}`}
            data-state={state}
            aria-pressed={state === 'on' ? true : state === 'some' ? 'mixed' : false}
            aria-label={audioDerived ? tr('fields.suggestionDetected', { value: s }) : undefined}
            onClick={() => onPick(s)}
            onPointerEnter={(e) => measureCut(e.currentTarget, s)}
            onFocus={(e) => measureCut(e.currentTarget, s)}
            // Colapsado, el chip puede encoger y truncar con elipsis — solo pasa en el caso
            // mínimo-1 (ni un chip cabe entero); si el corte dice que cabe, no encoge nada.
            className={`press inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-label transition-colors ${
              showAll ? 'shrink-0' : 'min-w-0'
            } ${
              state === 'on'
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-fg'
                : state === 'some'
                  ? 'border-[var(--color-accent)] text-fg'
                  : dim
                    ? 'border-[var(--color-line)] text-fg-faint hover:bg-[var(--color-hover)]'
                    : audioDerived
                      ? 'border-dashed border-[var(--color-line-strong)] text-fg-faint hover:bg-[var(--color-hover)]'
                      : 'border-[var(--color-line-strong)] text-fg-muted hover:bg-[var(--color-hover)]'
            }`}
          >
            {audioDerived ? (
              <Tooltip label={tr('fields.suggestionDetected', { value: s })} />
            ) : (
              <Tooltip label={cut === s ? s : ''} hoverOnly />
            )}
            {content(s)}
          </button>
        )
      })}
      {!chipsExpanded && chips.length > shownCount && (
        <button
          type="button"
          data-testid="chip-more"
          ref={moreRef}
          aria-expanded={false}
          onClick={() => {
            revealFromRef.current = shownCount
            setOpen(true)
          }}
          aria-label={tr('fields.suggestionsMore', {
            count: chips.length - shownCount,
          })}
          className="press shrink-0 rounded-full border border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] px-2 py-0.5 text-label text-[var(--color-accent)] transition-colors hover:bg-[var(--color-hover)]"
        >
          +{chips.length - shownCount}
        </button>
      )}
      {chipsExpanded && foldable && (
        <button
          type="button"
          data-testid="chip-less"
          aria-expanded={true}
          onClick={() => {
            foldedByHand.current = true
            setOpen(false)
          }}
          aria-label={tr('fields.suggestionsLess')}
          className="press shrink-0 rounded-full border border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] px-2 py-0.5 text-label text-[var(--color-accent)] transition-colors hover:bg-[var(--color-hover)]"
        >
          −
        </button>
      )}
      {
        // Fila gemela de medición: todos los chips más la sonda "+N" (con el mayor resto
        // posible, el caso más ancho), invisible y fuera del flujo. Debe replicar las clases
        // de tamaño de los chips reales (borde, padding, fuente) o las medidas mienten.
        // Sin testids: duplicaría los selectores chip-* de los chips reales.
        <span
          ref={measureRef}
          aria-hidden="true"
          className="invisible absolute top-0 left-0 flex items-center gap-1.5 whitespace-nowrap"
        >
          {chips.map((s) => (
            <span key={s} className="rounded-full border px-2 py-0.5 text-label">
              {content(s)}
            </span>
          ))}
          <span className="rounded-full border px-2 py-0.5 text-label">+{chips.length - 1}</span>
        </span>
      }
    </span>
  )
}
