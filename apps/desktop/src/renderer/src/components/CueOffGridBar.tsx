import { ChevronLeft, ChevronRight } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cueClock } from '../lib/cuePlayhead'
import { cueLetter } from '../lib/rowCues'
import { Tooltip } from './Tooltip'

export interface OffGridCue {
  kind: number
  ms: number
  driftMs: number
}

const SAME_DRIFT_MS = 5

function stopsOf(
  off: OffGridCue[],
  call: string,
): { ms: number; label: string; driftMs: number }[] {
  const byMs = new Map<number, OffGridCue[]>()
  for (const c of off) byMs.set(c.ms, [...(byMs.get(c.ms) ?? []), c])
  return [...byMs.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ms, cues]) => ({
      ms,
      driftMs: cues[0].driftMs,
      label: [...cues]
        .sort((a, b) => b.kind - a.kind)
        .map((c) => (c.kind === 0 ? call : cueLetter(c.kind)))
        .join(' + '),
    }))
}

function sharedDrift(off: OffGridCue[], stops: number): number | null {
  if (stops < 2) return null
  const drifts = off.map((c) => c.driftMs)
  if (Math.max(...drifts) - Math.min(...drifts) > SAME_DRIFT_MS) return null
  return Math.round(drifts.reduce((a, b) => a + b, 0) / drifts.length)
}

const STEP =
  'press flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-dim hover:bg-[var(--color-hover)] hover:text-fg'

export function CueOffGridBar({
  off,
  onGo,
  onSnap,
  onShiftGrid,
  spaced,
}: {
  off: OffGridCue[]
  onGo: (ms: number) => void
  onSnap: () => void
  onShiftGrid?: (ms: number) => void
  spaced?: boolean
}): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  const [at, setAt] = useState(0)
  const stops = stopsOf(off, tr('editor.cues.selectedCall'))
  if (stops.length === 0) return null
  const index = Math.min(at, stops.length - 1)
  const stop = stops[index]
  const step = (dir: 1 | -1) => {
    const next = (index + dir + stops.length) % stops.length
    setAt(next)
    onGo(stops[next].ms)
  }
  const shift = onShiftGrid ? sharedDrift(off, stops.length) : null
  return (
    <div
      data-testid="cues-offgrid"
      className={`${spaced ? 'mb-2' : 'shrink-0'} flex h-7 items-center gap-1 whitespace-nowrap rounded-md bg-[var(--color-warn)]/10 pr-1 pl-2.5 text-xs`}
    >
      <span aria-hidden="true" className="mr-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
      <button
        type="button"
        data-testid="cues-offgrid-prev"
        aria-label={tr('editor.cues.offGrid.prev')}
        onClick={() => step(-1)}
        className={STEP}
      >
        <ChevronLeft className="h-3 w-3" aria-hidden="true" />
      </button>
      <button
        type="button"
        data-testid={`cues-offgrid-go-${stop.ms}`}
        onClick={() => onGo(stop.ms)}
        className="press min-w-0 truncate rounded px-1 tabular-nums text-fg hover:bg-[var(--color-hover)]"
      >
        <Tooltip label={tr('editor.cues.offGrid.go')} />
        <span className="font-semibold">{stop.label}</span> {cueClock(stop.ms)} ·{' '}
        <span className="text-warn">
          {tr(stop.driftMs < 0 ? 'editor.cues.offGrid.before' : 'editor.cues.offGrid.after', {
            ms: Math.round(Math.abs(stop.driftMs)),
          })}
        </span>
      </button>
      <button
        type="button"
        data-testid="cues-offgrid-next"
        aria-label={tr('editor.cues.offGrid.next')}
        onClick={() => step(1)}
        className={STEP}
      >
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
      </button>
      <span data-testid="cues-offgrid-position" className="shrink-0 tabular-nums text-fg-dim">
        {tr('editor.cues.offGrid.position', { at: index + 1, total: stops.length })}
      </span>
      <span className="flex-1" />
      {shift !== null && onShiftGrid && (
        <button
          type="button"
          data-testid="cues-offgrid-shift-grid"
          onClick={() => onShiftGrid(shift)}
          className="press shrink-0 rounded px-1.5 font-medium text-accent hover:bg-[var(--color-hover)]"
        >
          {tr('editor.cues.offGrid.shiftGrid', { ms: shift })}
        </button>
      )}
      <button
        type="button"
        data-testid="cues-offgrid-snap"
        onClick={onSnap}
        className="press shrink-0 rounded px-1.5 font-medium text-accent hover:bg-[var(--color-hover)]"
      >
        {tr('editor.cues.offGrid.snap')}
      </button>
    </div>
  )
}
