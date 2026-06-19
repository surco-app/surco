import {
  AudioLines,
  Check,
  ChevronDown,
  CircleCheckBig,
  FileAudio,
  List,
  type LucideIcon,
  Plus,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import type React from 'react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { QualityFilter, qualityCounts } from '../lib/triage'

// One Lucide glyph per quality/provenance/library bucket, kept consistent with the toolbar.
// Per-format buckets are a separate axis and all share the audio-file glyph.
const FILTER_ICONS: Record<QualityFilter, LucideIcon> = {
  all: List,
  suspect: TriangleAlert,
  good: CircleCheckBig,
  unanalyzed: AudioLines,
  unconverted: RefreshCw,
  automatched: Sparkles,
  inLibrary: Check,
  notInLibrary: Plus,
}

type Tally = ReturnType<typeof qualityCounts>

// The attention dot draws the eye to buckets that need action: amber for suspect (likely
// fake rips), accent for the still-to-convert backlog. Null for the rest.
function attentionDot(mode: QualityFilter, tally: Tally): string | null {
  if (mode === 'suspect' && tally.suspect > 0) return 'bg-warn'
  if (mode === 'unconverted' && tally.unconverted > 0) return 'bg-[var(--color-accent)]'
  return null
}

interface Props {
  // The sticky filter header, measured by App when paging the scroll position.
  filterRef: React.RefObject<HTMLDivElement | null>
  value: QualityFilter
  onChange: (mode: QualityFilter) => void
  tally: Tally
  // The distinct source formats present, each with its count — only populated for a mixed
  // crate so a single-format list grows no format section. This is a separate filter axis
  // (formatValue), ANDed with the primary `value` bucket.
  formats: { format: string; count: number }[]
  formatValue: string | null
  onFormatChange: (format: string | null) => void
  trackCount: number
  visibleCount: number
  // 1-based position of the selected row within the current view, or null.
  selectedPosition: number | null
  // Controls that share the filter row — the track sort and its direction toggle — sitting
  // beside the filter trigger so the search box above can take the full width.
  children?: React.ReactNode
}

// The sidebar's quality-triage filter: a single dropdown (so a wide crate's many buckets
// and large counts can never overflow the narrow, resizable sidebar the way a row of
// chips did), plus the always-visible "x/total" position counter. The buckets — with the
// provenance and Apple Music ones appearing only once they have something to show — list
// inside the menu, each with its icon, count and attention dot. Presentational: App owns
// the filter state, the tallies and the counts and hands them in. Mirrors Select's
// interaction (focus the active option on open, Escape/backdrop close, arrow keys move).
export function QualityFilterBar({
  filterRef,
  value,
  onChange,
  tally,
  formats,
  formatValue,
  onFormatChange,
  trackCount,
  visibleCount,
  selectedPosition,
  children,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // The primary buckets that follow "All" and the format axis, in logical groups rendered
  // with a thin divider between them so the menu reads by dimension. Empty groups drop out,
  // so the dividers only ever separate groups that actually have something to show.
  const primarySections: QualityFilter[][] = [
    // The quality verdict.
    ['unanalyzed', 'suspect', 'good'],
    // Conversion status and provenance: the auto-matched bucket joins only once something
    // has been auto-filled, so the menu isn't padded with a permanently-empty filter.
    ['unconverted', ...(tally.automatched > 0 ? (['automatched'] as const) : [])],
    // Apple Music library buckets, listed only once the snapshot has resolved a verdict
    // for at least one track — which also keeps them off Windows, where there is no
    // library to read. "Not in library" leads: it's the actionable bucket.
    ...(tally.inLibrary + tally.notInLibrary > 0
      ? [['notInLibrary', 'inLibrary'] as QualityFilter[]]
      : []),
  ]
  const countOf = (mode: QualityFilter): number =>
    mode === 'all' ? trackCount : tally[mode as keyof Tally]
  // "All" is the reset, not a primary value alongside a format: it reads as selected only
  // when nothing is filtered on either axis, so picking a format (or a bucket) visibly
  // clears its tick.
  const allActive = value === 'all' && !formatValue

  // Focus the active option when the menu opens, so the arrows continue from the current
  // choice like a native select.
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-testid="quality-filter-${value}"]`)?.focus()
  }, [open, value])

  function close(): void {
    setOpen(false)
    triggerRef.current?.focus()
  }

  function choose(next: QualityFilter): void {
    onChange(next)
    close()
  }

  // Toggling a format closes the menu like a primary pick — the combination still holds
  // (the primary stays selected in state), the user just reopens to layer the other axis.
  function chooseFormat(format: string | null): void {
    onFormatChange(format)
    close()
  }

  // "All" clears both axes at once, so it's a true "show everything" reset rather than only
  // resetting the primary bucket and leaving a format quietly applied.
  function chooseAll(): void {
    onChange('all')
    onFormatChange(null)
    close()
  }

  // The open menu owns its keys: each handled press stops propagating so the window-level
  // shortcut handler can't also move the track selection behind the popover.
  function onListKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation()
      return
    }
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
    )
    if (items.length === 0) return
    const idx = items.indexOf(document.activeElement as HTMLElement)
    let next = -1
    if (e.key === 'ArrowDown') next = idx < items.length - 1 ? idx + 1 : 0
    else if (e.key === 'ArrowUp') next = idx > 0 ? idx - 1 : items.length - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    if (next === -1) return
    e.preventDefault()
    e.stopPropagation()
    items[next].focus()
  }

  // With no primary bucket chosen, surface the active format on the trigger instead of a
  // bare "All" (which the menu now shows unchecked once a format is on) — so a closed menu
  // still tells the user what's filtering. A chosen bucket takes the label; format then
  // only shows inside the menu.
  const triggerFormat = value === 'all' ? formats.find((f) => f.format === formatValue) : undefined
  const ActiveIcon = triggerFormat ? FileAudio : FILTER_ICONS[value]
  // Keep the suspect nudge on the trigger even when another filter is active, so a crate
  // full of likely-fake rips still flags itself now that the buckets are hidden in a menu.
  const triggerDot =
    attentionDot(value, tally) ?? (value !== 'suspect' && tally.suspect > 0 ? 'bg-warn' : null)

  const rowClass =
    'flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-xs text-fg transition-colors hover:bg-[var(--color-panel-2)]'
  const divider = (
    <hr
      data-testid="quality-filter-separator"
      className="my-1 border-0 border-t border-[var(--color-line)]"
    />
  )
  // A primary bucket row. "All" is the odd one out: it reads as selected only when nothing
  // is filtered and clears both axes, so it gets allActive/chooseAll instead of the plain
  // value match.
  const renderPrimary = (mode: QualityFilter): React.JSX.Element => {
    const Icon = FILTER_ICONS[mode]
    const dot = attentionDot(mode, tally)
    const selected = mode === 'all' ? allActive : mode === value
    return (
      <button
        key={mode}
        type="button"
        role="option"
        aria-selected={selected}
        data-testid={`quality-filter-${mode}`}
        onClick={mode === 'all' ? chooseAll : () => choose(mode)}
        className={rowClass}
      >
        <span className="relative">
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          {dot && <span className={`absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full ${dot}`} />}
        </span>
        <span className="flex-1">{tr(`sidebar.filter.${mode}`)}</span>
        <span className="tabular-nums text-fg-dim">{countOf(mode)}</span>
        <Check aria-hidden="true" className={`size-3 shrink-0 ${selected ? '' : 'invisible'}`} />
      </button>
    )
  }
  // A format bucket row: an independent toggle that ANDs with the primary bucket. Clicking
  // the active one clears it.
  const renderFormat = (f: { format: string; count: number }): React.JSX.Element => {
    const active = formatValue === f.format
    return (
      <button
        key={f.format}
        type="button"
        role="option"
        aria-selected={active}
        data-testid={`quality-filter-ext:${f.format}`}
        onClick={() => chooseFormat(active ? null : f.format)}
        className={rowClass}
      >
        <FileAudio className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="flex-1">{f.format}</span>
        <span className="tabular-nums text-fg-dim">{f.count}</span>
        <Check aria-hidden="true" className={`size-3 shrink-0 ${active ? '' : 'invisible'}`} />
      </button>
    )
  }

  return (
    <div
      ref={filterRef}
      data-testid="quality-filter"
      className="flex items-center gap-1.5 px-1.5 py-2"
    >
      <div className="relative shrink-0">
        <button
          ref={triggerRef}
          type="button"
          data-testid="quality-filter-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={tr('sidebar.filter.label')}
          onClick={() => setOpen((v) => !v)}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-line)] bg-[var(--color-field)] pr-1.5 pl-2 text-xs font-medium text-fg-dim outline-none focus:border-[var(--color-accent)]"
        >
          <span className="relative">
            <ActiveIcon className="h-4 w-4" aria-hidden="true" />
            {triggerDot && (
              <span className={`absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full ${triggerDot}`} />
            )}
          </span>
          <span>{triggerFormat ? triggerFormat.format : tr(`sidebar.filter.${value}`)}</span>
          <span className="tabular-nums opacity-70">
            {triggerFormat ? triggerFormat.count : countOf(value)}
          </span>
          <ChevronDown aria-hidden="true" className="size-3.5" />
        </button>
        {open && (
          <>
            <button
              type="button"
              data-testid="quality-filter-backdrop"
              aria-label={tr('common.close')}
              onClick={close}
              className="fixed inset-0 z-40 cursor-default"
            />
            <div
              ref={listRef}
              role="listbox"
              data-testid="quality-filter-listbox"
              aria-label={tr('sidebar.filter.label')}
              onKeyDown={onListKeyDown}
              className="animate-pop absolute left-0 z-50 mt-1 min-w-full rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-1 shadow-xl"
            >
              {/* "All" leads as the reset. The format axis sits right under it (both narrow
                  the view's "scope"), then the quality/conversion/library buckets. Fragments
                  keep every option a direct child of the listbox, with a divider between
                  sections; empty sections (no formats, no library) drop their divider too. */}
              {renderPrimary('all')}
              {formats.length > 0 && (
                <Fragment key="formats">
                  {divider}
                  {formats.map(renderFormat)}
                </Fragment>
              )}
              {primarySections.map((group) => (
                <Fragment key={group[0]}>
                  {divider}
                  {group.map(renderPrimary)}
                </Fragment>
              ))}
            </div>
          </>
        )}
      </div>
      {children}
      {visibleCount > 0 && (
        <span
          data-testid="track-position"
          title={
            selectedPosition !== null
              ? tr('sidebar.position', { current: selectedPosition, total: visibleCount })
              : undefined
          }
          className="ml-auto self-center pr-0.5 pl-1 text-xs tabular-nums text-fg-faint"
        >
          {selectedPosition !== null ? `${selectedPosition}/${visibleCount}` : `–/${visibleCount}`}
        </span>
      )}
    </div>
  )
}
