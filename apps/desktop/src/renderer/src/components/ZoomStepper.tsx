import { Minus, Plus } from 'lucide-react'
import type React from 'react'
import { Tooltip } from './Tooltip'

// The one zoom control, shared by every section that shows a wave.
//
// It exists because the sections had each grown their own, and they disagreed: the
// trim lane put "closer" on the LEFT, the beatgrid put it on the RIGHT. Both had
// followed their own NUMBER — zooming in makes the beatgrid's factor climb (×1 → ×32)
// but makes the trim's context shrink (±15 s → ±2 s) — so the same gesture ended up
// on opposite sides depending on which section you were in.
//
// The order is therefore fixed by the ACTION, never by the number: less on the left,
// more on the right, like every volume and brightness control ever made. And the
// steps are a bare − and + rather than magnifiers, because a magnifier-plus icon
// promises a bigger number, which is exactly what a tighter trim context does not do.
//
// The value between them is the reset (back to the whole track / the default
// context). It was already clickable, but rendered as plain text between two boxes
// nobody could tell — so it wears the same box as its neighbours.
export function ZoomStepper({
  label,
  onOut,
  onIn,
  onReset,
  outDisabled = false,
  inDisabled = false,
  resetDisabled = false,
  labels,
  size = 'sm',
  testids,
}: {
  // The current level, already formatted by the caller — "×32", "±5s". Only the
  // caller knows what its scale means.
  label: string
  onOut: () => void
  onIn: () => void
  onReset: () => void
  outDisabled?: boolean
  inDisabled?: boolean
  resetDisabled?: boolean
  labels: { out: string; in: string; reset: string }
  size?: 'sm' | 'lg'
  // Kept as a prop so each section keeps the ids its tests already know.
  testids: { out: string; in: string; reset: string }
}): React.JSX.Element {
  const box = size === 'lg' ? 'h-8 w-8' : 'h-7 w-7'
  const glyph = size === 'lg' ? 'h-4 w-4' : 'h-3.5 w-3.5'
  const chrome =
    'press relative flex shrink-0 items-center justify-center border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg-muted'
  return (
    // One segmented control, not three loose buttons: the three parts are one
    // decision (how close am I looking), so they share an outline and the rounding
    // falls on the ends.
    <span className="flex shrink-0 items-center">
      <button
        type="button"
        data-testid={testids.out}
        aria-label={labels.out}
        disabled={outDisabled}
        onClick={onOut}
        className={`${chrome} ${box} rounded-l-md`}
      >
        <Minus className={glyph} aria-hidden="true" />
        <Tooltip label={labels.out} />
      </button>
      <button
        type="button"
        data-testid={testids.reset}
        aria-label={labels.reset}
        disabled={resetDisabled}
        onClick={onReset}
        className={`${chrome} ${size === 'lg' ? 'h-8' : 'h-7'} -mx-px min-w-12 px-1.5 text-[10px] tabular-nums`}
      >
        {label}
        <Tooltip label={labels.reset} />
      </button>
      <button
        type="button"
        data-testid={testids.in}
        aria-label={labels.in}
        disabled={inDisabled}
        onClick={onIn}
        className={`${chrome} ${box} rounded-r-md`}
      >
        <Plus className={glyph} aria-hidden="true" />
        <Tooltip label={labels.in} />
      </button>
    </span>
  )
}
