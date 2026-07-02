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
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TriangleAlert,
  Copy as CopyIcon,
} from 'lucide-react'
import type React from 'react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EMPTY_FILTER, type FilterSelection, type qualityCounts } from '../lib/triage'
import { Tooltip } from './Tooltip'

// The selectable bucket modes, one row each, grouped by the dimension they belong to.
type QualityMode = 'unanalyzed' | 'suspect' | 'good'
type ConversionMode = 'unconverted' | 'automatched'
type LibraryMode = 'inLibrary' | 'notInLibrary'
type DuplicatesMode = 'duplicates'
type Mode = QualityMode | ConversionMode | LibraryMode | DuplicatesMode

const QUALITY_MODES: QualityMode[] = ['unanalyzed', 'suspect', 'good']
const CONVERSION_MODES: ConversionMode[] = ['unconverted', 'automatched']
const LIBRARY_MODES: LibraryMode[] = ['notInLibrary', 'inLibrary']
const DUPLICATES_MODES: DuplicatesMode[] = ['duplicates']

// One Lucide glyph per quality/provenance/library bucket, kept consistent with the toolbar.
// Per-format buckets are a separate axis and all share the audio-file glyph.
const FILTER_ICONS: Record<Mode | 'all', LucideIcon> = {
  all: List,
  suspect: TriangleAlert,
  good: CircleCheckBig,
  unanalyzed: AudioLines,
  unconverted: RefreshCw,
  automatched: Sparkles,
  inLibrary: Check,
  notInLibrary: Plus,
  duplicates: CopyIcon,
}

type Tally = ReturnType<typeof qualityCounts>

// Which selection axis a bucket row toggles. Lets one handler flip the right field and one
// check read the right field, so a pick from each section can coexist.
function axisOf(mode: Mode): keyof Omit<FilterSelection, 'format'> {
  if ((QUALITY_MODES as string[]).includes(mode)) return 'quality'
  if ((CONVERSION_MODES as string[]).includes(mode)) return 'conversion'
  if (mode === 'duplicates') return 'duplicates'
  return 'library'
}

// The attention dot draws the eye to buckets that need action: amber for suspect (likely
// fake rips), accent for the still-to-convert backlog. Null for the rest.
function attentionDot(mode: Mode, tally: Tally): string | null {
  if (mode === 'suspect' && tally.suspect > 0) return 'bg-warn'
  if (mode === 'unconverted' && tally.unconverted > 0) return 'bg-[var(--color-accent)]'
  return null
}

interface Props {
  // The sticky filter header, measured by App when paging the scroll position.
  filterRef: React.RefObject<HTMLDivElement | null>
  // The combined selection — one choice per axis (quality / conversion / library / format),
  // all ANDed. The bar toggles a single axis per click and leaves the menu open, so picking
  // one from each section stacks the filters instead of replacing the previous choice.
  value: FilterSelection
  onChange: (next: FilterSelection) => void
  tally: Tally
  // The distinct source formats present, each with its count — only populated for a mixed
  // crate so a single-format list grows no format section.
  formats: { format: string; count: number }[]
  trackCount: number
  visibleCount: number
  // 1-based position of the selected row within the current view, or null.
  selectedPosition: number | null
  // How many rows are selected. Above one the counter shows "N selected" instead of a
  // position, so a multi-select shows its size where the single-track position usually sits.
  selectedCount: number
  // Scrolls the selected row into view — the position counter clicks through to it, so a
  // number the DJ can see becomes a way back to the row it counts.
  onRevealSelected: () => void
  // Moves every flagged rip to the Trash (after App's confirm). Surfaced as a one-click button
  // only while the suspect bucket is the active filter and holds fakes, so the destructive
  // action appears exactly when the DJ is looking at the fakes it would purge.
  onTrashSuspects: () => void
  // Controls that share the filter row — the track sort and its direction toggle — sitting
  // beside the filter trigger so the search box above can take the full width.
  children?: React.ReactNode
}

// The sidebar's quality-triage filter: a single dropdown (so a wide crate's many buckets
// and large counts can never overflow the narrow, resizable sidebar the way a row of
// chips did), plus the always-visible "x/total" position counter. Each dimension is an
// independent axis — picking a bucket toggles only its axis and keeps the menu open, so a
// DJ can layer one choice from each section ("not in Apple Music" + "good" + "WAV") in one
// pass. The buckets — with the provenance and Apple Music ones appearing only once they
// have something to show — list inside the menu, each with its icon, count and attention
// dot. Presentational: App owns the selection, the tallies and the counts and hands them
// in. Mirrors Select's interaction (focus the active option on open, Escape/backdrop close,
// arrow keys move).
export function QualityFilterBar({
  filterRef,
  value,
  onChange,
  tally,
  formats,
  trackCount,
  visibleCount,
  selectedPosition,
  selectedCount,
  onRevealSelected,
  onTrashSuspects,
  children,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Conversion status and provenance, surfaced right under "All": "unconverted" is the
  // primary call to action (the whole backlog to convert), so it leads the buckets instead
  // of trailing them. The auto-matched bucket joins only once something has been auto-filled,
  // so the menu isn't padded with a permanently-empty filter.
  const conversionSection: Mode[] = CONVERSION_MODES.filter(
    (m) => m !== 'automatched' || tally.automatched > 0,
  )
  // The remaining buckets that follow the format axis, in logical groups rendered with a
  // thin divider between them so the menu reads by dimension. Empty groups drop out, so the
  // dividers only ever separate groups that actually have something to show.
  const primarySections: Mode[][] = [
    // The quality verdict.
    QUALITY_MODES,
    // Apple Music library buckets, listed only once the snapshot has resolved a verdict
    // for at least one track — which also keeps them off Windows, where there is no
    // library to read. "Not in library" leads: it's the actionable bucket.
    ...(tally.inLibrary + tally.notInLibrary > 0 ? [LIBRARY_MODES] : []),
    // Only once the crate actually holds the same song twice — a permanently-empty
    // duplicates bucket would just pad the menu.
    ...(tally.duplicates > 0 ? [DUPLICATES_MODES] : []),
  ]
  const countOf = (mode: Mode): number => tally[mode as keyof Tally]
  const isActive = (mode: Mode): boolean => value[axisOf(mode)] === mode
  // "All" reads as selected only when nothing is filtered on any axis, so picking a bucket
  // or a format visibly clears its tick.
  const nothingActive =
    !value.quality && !value.conversion && !value.library && !value.duplicates && !value.format

  // Focus an active option when the menu opens (the first set axis, or "All" when nothing
  // is), so the arrows continue from the current choice like a native select.
  const focusMode = value.quality ?? value.conversion ?? value.library ?? value.duplicates ?? 'all'
  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-testid="quality-filter-${focusMode}"]`)
      ?.focus()
  }, [open, focusMode])

  function close(): void {
    setOpen(false)
    triggerRef.current?.focus()
  }

  // Toggle one axis and close, like a native select. The axes are still independent — the
  // reopened menu shows the current ticks — so layering a second axis is one reopen away,
  // while the common single-filter pick closes the moment it's made.
  function toggle(mode: Mode): void {
    const axis = axisOf(mode)
    onChange({ ...value, [axis]: isActive(mode) ? null : mode })
    close()
  }

  function toggleFormat(format: string): void {
    onChange({ ...value, format: value.format === format ? null : format })
    close()
  }

  // "All" clears every axis at once, so it's a true "show everything" reset rather than
  // only resetting one dimension and leaving the others quietly applied.
  function chooseAll(): void {
    onChange(EMPTY_FILTER)
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

  // What the closed trigger shows. With nothing active it's a bare "All"; with exactly one
  // axis it surfaces that bucket (icon, label, count) so the user sees what's filtering
  // without opening; with several it collapses to a generic "Filters" badge counting the
  // tracks that survive the combined filter (the per-axis counts are absolute, so none of
  // them would describe the intersection).
  const activeChips: { Icon: LucideIcon; label: string; count: number }[] = []
  if (value.quality)
    activeChips.push({
      Icon: FILTER_ICONS[value.quality],
      label: tr(`sidebar.filter.${value.quality}`),
      count: countOf(value.quality),
    })
  if (value.conversion)
    activeChips.push({
      Icon: FILTER_ICONS[value.conversion],
      label: tr(`sidebar.filter.${value.conversion}`),
      count: countOf(value.conversion),
    })
  if (value.library)
    activeChips.push({
      Icon: FILTER_ICONS[value.library],
      label: tr(`sidebar.filter.${value.library}`),
      count: countOf(value.library),
    })
  if (value.duplicates)
    activeChips.push({
      Icon: FILTER_ICONS.duplicates,
      label: tr('sidebar.filter.duplicates'),
      count: countOf('duplicates'),
    })
  if (value.format)
    activeChips.push({
      Icon: FileAudio,
      label: value.format,
      count: formats.find((f) => f.format === value.format)?.count ?? 0,
    })

  const trigger =
    activeChips.length === 0
      ? { Icon: List, label: tr('sidebar.filter.all'), count: trackCount }
      : activeChips.length === 1
        ? activeChips[0]
        : { Icon: SlidersHorizontal, label: tr('sidebar.filter.multiple'), count: visibleCount }
  // Keep the suspect nudge on the trigger even when another filter is active, so a crate
  // full of likely-fake rips still flags itself now that the buckets are hidden in a menu.
  const triggerDot =
    (value.conversion === 'unconverted' && tally.unconverted > 0
      ? 'bg-[var(--color-accent)]'
      : null) ?? (tally.suspect > 0 ? 'bg-warn' : null)

  const rowClass =
    'flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-xs text-fg transition-colors hover:bg-[var(--color-panel-2)]'
  const divider = (
    <hr
      data-testid="quality-filter-separator"
      className="my-1 border-0 border-t border-[var(--color-line)]"
    />
  )
  // A primary bucket row. "All" is the odd one out: it reads as selected only when nothing
  // is filtered and clears every axis, so it gets nothingActive/chooseAll instead of the
  // plain axis match.
  const renderPrimary = (mode: Mode | 'all'): React.JSX.Element => {
    const Icon = FILTER_ICONS[mode]
    const dot = mode === 'all' ? null : attentionDot(mode, tally)
    const selected = mode === 'all' ? nothingActive : isActive(mode)
    return (
      <button
        key={mode}
        type="button"
        role="option"
        aria-selected={selected}
        data-testid={`quality-filter-${mode}`}
        onClick={mode === 'all' ? chooseAll : () => toggle(mode)}
        className={rowClass}
      >
        <span className="relative">
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          {dot && <span className={`absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full ${dot}`} />}
        </span>
        <span className="flex-1">{tr(`sidebar.filter.${mode}`)}</span>
        <span className="tabular-nums text-fg-dim">
          {mode === 'all' ? trackCount : countOf(mode)}
        </span>
        <Check aria-hidden="true" className={`size-3 shrink-0 ${selected ? '' : 'invisible'}`} />
      </button>
    )
  }
  // A format bucket row: an independent toggle that ANDs with the bucket axes. Clicking the
  // active one clears it.
  const renderFormat = (f: { format: string; count: number }): React.JSX.Element => {
    const active = value.format === f.format
    return (
      <button
        key={f.format}
        type="button"
        role="option"
        aria-selected={active}
        data-testid={`quality-filter-ext:${f.format}`}
        onClick={() => toggleFormat(f.format)}
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
      <div className="relative min-w-0 flex-1">
        <button
          ref={triggerRef}
          type="button"
          data-testid="quality-filter-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={tr('sidebar.filter.label')}
          onClick={() => setOpen((v) => !v)}
          className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md border border-[var(--color-line)] bg-[var(--color-field)] pr-1.5 pl-2 text-xs font-medium text-fg-dim outline-none focus:border-[var(--color-accent)]"
        >
          <span className="relative shrink-0">
            <trigger.Icon className="h-4 w-4" aria-hidden="true" />
            {triggerDot && (
              <span className={`absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full ${triggerDot}`} />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-left">{trigger.label}</span>
          <span className="shrink-0 tabular-nums opacity-70">{trigger.count}</span>
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
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
              {/* "All" leads as the reset, then the conversion buckets right under it (the
                  primary "what's left to convert" action), then the format axis, then the
                  quality/library buckets. Fragments keep every option a direct child of the
                  listbox, with a divider between sections; empty sections (no formats, no
                  library) drop their divider too. */}
              {renderPrimary('all')}
              <Fragment key="conversion">
                {divider}
                {conversionSection.map(renderPrimary)}
              </Fragment>
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
      {value.quality === 'suspect' && tally.suspect > 0 && (
        <button
          type="button"
          data-testid="trash-suspects"
          aria-label={tr('sidebar.filter.trashSuspects', { count: tally.suspect })}
          onClick={onTrashSuspects}
          className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--color-line)] bg-[var(--color-field)] text-fg-dim outline-none hover:border-warn hover:text-warn focus:border-[var(--color-accent)]"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          <Tooltip label={tr('sidebar.filter.trashSuspects', { count: tally.suspect })} />
        </button>
      )}
      {selectedCount > 1 ? (
        <span
          data-testid="track-selected-count"
          className="relative ml-auto self-center pr-0.5 pl-1 text-xs tabular-nums text-fg-dim"
        >
          {tr('sidebar.selectedCount', { count: selectedCount })}
        </span>
      ) : (
        visibleCount > 0 &&
        (selectedPosition !== null ? (
          <button
            type="button"
            data-testid="track-position"
            onClick={onRevealSelected}
            className="press relative ml-auto self-center rounded pr-0.5 pl-1 text-xs tabular-nums text-fg-faint outline-none hover:text-fg"
          >
            {`${selectedPosition}/${visibleCount}`}
            <Tooltip label={tr('header.revealSelected')} />
          </button>
        ) : (
          <span
            data-testid="track-position"
            className="relative ml-auto self-center pr-0.5 pl-1 text-xs tabular-nums text-fg-faint"
          >
            {`‒/${visibleCount}`}
          </span>
        ))
      )}
    </div>
  )
}
