import { Music } from 'lucide-react'
import type React from 'react'

// The pieces of a library row that other lists share, so a list that is not the track list
// still reads as the same list: the row's fill, its cover tile, its two lines of text and the
// tinted pill on the right.

export function listRowClass(primary: boolean, selected: boolean): string {
  return `group/row relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-[transform] duration-200 ease-out ${
    // The primary row (the one open in the editor) takes the selection fill, the way
    // Finder/Mail fill the active row. A multi-selected-but-not-primary row gets the
    // quieter accent tint. Everything else is bare: no outline and no fill of its own,
    // like the lists in Music or Mail, so the page of rows reads as one list instead of
    // a stack of cards, and only the hover tints it.
    primary
      ? 'is-primary bg-[var(--color-row-selected)]'
      : selected
        ? 'bg-[var(--color-accent-soft)]/85'
        : 'hover:bg-[var(--color-hover)]/85'
  } focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[var(--color-accent)]`
}

export const ROW_TITLE = 'relative block w-fit max-w-full truncate text-sm font-medium text-fg'
export const ROW_DETAIL = 'relative block min-w-0 flex-1 truncate text-xs text-fg-dim'
export const ROW_TRAILING = 'shrink-0 text-right text-xs tabular-nums text-fg-dim'
export const PILL_TEXT = 'text-[10px] font-semibold leading-4'

export function CoverPlaceholder({
  testid,
  round = false,
}: {
  testid: string
  round?: boolean
}): React.JSX.Element {
  return (
    <span
      data-testid={testid}
      className={`flex h-8 w-8 items-center justify-center bg-[var(--color-panel-2)] outline outline-1 -outline-offset-1 outline-on-scrim/10 transition-[border-radius] duration-300 ${
        round ? 'rounded-full' : 'rounded-md'
      }`}
    >
      <Music className="h-3.5 w-3.5 text-fg-faint" aria-hidden="true" />
    </span>
  )
}

export type PillTone = 'good' | 'warn' | 'danger'

const PILL_TONE: Record<PillTone, string> = {
  good: 'bg-good/15 text-good',
  warn: 'bg-warn/20 text-warn',
  danger: 'bg-danger/20 text-danger',
}

// The stylesheet keys the selected row's opaque pill off each list's testid and data-tone.
export function TonePill({
  testid,
  tone,
  quality,
  children,
}: {
  testid: string
  tone: PillTone
  quality?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span
      data-testid={testid}
      data-quality={quality}
      data-tone={tone}
      className={`group/dot relative flex h-4 items-center gap-[3px] rounded px-[5px] ${PILL_TONE[tone]}`}
    >
      {children}
    </span>
  )
}

// A hollow ring, not a filled dot: the conversion state shares the amber/red palette with
// the quality stripe/glyph on the same row, so a solid coin read as a second alarm. As a
// thin outline it still carries its colour but sits back a weight, keeping the two axes —
// conversion (this corner) and quality (the left stripe) — from competing.
const badgeBase =
  'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 bg-[var(--color-ink)] ring-2 ring-[var(--color-ink)]'

// Amber is kept for what needs the user (here, changes not yet applied); a running
// conversion needs nothing from them, so it pulses in the accent instead.
const badgeTone = {
  attention: 'border-warn',
  busy: 'animate-pulse border-[var(--color-accent)]',
} as const

export function ToneBadge({
  testid,
  tone,
}: {
  testid: string
  tone: keyof typeof badgeTone
}): React.JSX.Element {
  return (
    <span data-testid={testid} data-tone={tone} className={`${badgeBase} ${badgeTone[tone]}`} />
  )
}
