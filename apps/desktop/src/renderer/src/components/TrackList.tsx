import {
  Check,
  CircleCheck,
  type LucideIcon,
  Music,
  OctagonAlert,
  Play,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react'
import type React from 'react'
import { memo, type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStableCallback } from '../hooks/useStableCallback'
import type { OutputFormat } from '../../../shared/types'
import { isStale } from '../lib/dirty'
import { formatTime } from '../lib/duration'
import { STAGE_PROGRESS } from '../lib/progress'
import type { ClickMods } from '../lib/selection'
import { sourceFormat, type TrackQuality, trackQuality } from '../lib/triage'
import type { TrackItem, TrackStatus } from '../types'
import { Tooltip } from './Tooltip'
import { TrackContextMenu } from './TrackContextMenu'

interface Props {
  tracks: TrackItem[]
  selectedId: string | null
  selectedIds: ReadonlySet<string>
  outputFormat: OutputFormat
  onSelect: (id: string, mods: ClickMods) => void
  // Double-clicking a row plays it: opens the floating player straight on that track.
  onActivate: (track: TrackItem) => void
  onRemove: (id: string) => void
  onPrefetch: (id: string) => void
  onSearch: (id: string) => void
  onStartOver: (track: TrackItem) => void
  onCopyMeta: (track: TrackItem) => void
  onCopyPath: (track: TrackItem) => void
  onPasteMeta: (track: TrackItem) => void
  canPasteMeta: boolean
  onTrash: (track: TrackItem) => void
  // Optional viewport tracking: the scroll pane each row observes against and a callback
  // reporting when a row enters or leaves it, so App can gate auto-match to the rows on screen.
  scrollRootRef?: RefObject<HTMLElement | null>
  onVisible?: (id: string, visible: boolean) => void
  // Row buttons by track id, kept current as rows mount/unmount, so App can focus
  // and measure rows without querying the DOM by test id.
  rowRegistry?: RefObject<Map<string, HTMLButtonElement>>
}

type MenuState = { track: TrackItem; x: number; y: number }

// Only the live/problem states reach this map now: idle renders nothing and done gets its
// own check badge below. Kept exhaustive so the lookup stays total over TrackStatus.
const statusColor: Record<TrackStatus, string> = {
  idle: 'bg-fg-faint',
  processing: 'bg-warn animate-pulse',
  done: 'bg-good',
  error: 'bg-danger',
}

const badgeBase =
  'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--color-panel)]'

function StatusBadge({
  track,
  stale,
}: {
  track: TrackItem
  stale: boolean
}): React.JSX.Element | null {
  // Stale wins over done: a converted track edited afterwards shows steady amber (unlike the
  // processing pulse) so pending Updates stay visible and can be batched for later.
  if (stale) return <span className={`${badgeBase} bg-warn`} />
  // done lands as a check on a Tokyo Night accent coin — an unmistakable "converted" mark,
  // set apart from the round transient/problem dots by its shape. The check uses the ink token
  // so it keeps contrast on the accent in both the light and dark themes.
  if (track.status === 'done')
    return (
      <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--color-accent)] ring-2 ring-[var(--color-panel)]">
        <Check aria-hidden className="h-2.5 w-2.5 text-[var(--color-ink)]" strokeWidth={3} />
      </span>
    )
  // idle is the default for nearly every imported row, so a constant grey dot says nothing; a
  // clean corner now reads as "not converted yet" and lets the live states stand out.
  if (track.status === 'idle') return null
  return <span className={`${badgeBase} ${statusColor[track.status]}`} />
}

// The verdicts that actually render a glyph — every TrackQuality except 'unanalyzed',
// which the row leaves blank (guarded before QualityMark is reached).
type RowVerdict = Exclude<TrackQuality, 'unanalyzed'>

// The quality verdict reads as a distinct severity glyph, not a second colored dot, so it
// can't be mistaken for the round conversion-status light on the cover corner (both share the
// green/amber/red palette). good stays a quiet check — positive confirmation without
// shouting — while warn/bad escalate by both shape and color. transcoded (fake lossless)
// shares bad's red octagon: it's the same "reject" severity, distinguished by its "Fake
// lossless" tooltip rather than a new colour, so the row palette stays green/amber/red.
const qualityIcon: Record<RowVerdict, { Icon: LucideIcon; className: string }> = {
  good: { Icon: CircleCheck, className: 'text-good/70' },
  warn: { Icon: TriangleAlert, className: 'text-warn' },
  bad: { Icon: OctagonAlert, className: 'text-danger' },
  processed: { Icon: OctagonAlert, className: 'text-danger' },
  transcoded: { Icon: OctagonAlert, className: 'text-danger' },
}

const qualityLabel: Record<RowVerdict, string> = {
  good: 'editor.qualityGood',
  warn: 'editor.qualitySuspect',
  bad: 'editor.qualityBad',
  processed: 'editor.qualityProcessed',
  transcoded: 'editor.qualityTranscode',
}

function QualityMark({ verdict, label }: { verdict: RowVerdict; label: string }): React.JSX.Element {
  const { Icon, className } = qualityIcon[verdict]
  return (
    <span data-testid="track-quality" data-quality={verdict} className="group/dot relative flex">
      <Icon aria-hidden className={`h-3 w-3 ${className}`} />
      <Tooltip label={label} align="end" scope="dot" />
    </span>
  )
}

// Appends the match's confidence ("· 96%") to the tooltip so hovering the row surfaces how
// strong the auto-match was. Hand-picked matches carry no confidence, so the label stands alone.
function matchTooltip(label: string, confidence: number | undefined): string {
  return confidence === undefined ? label : `${label} · ${Math.round(confidence * 100)}%`
}

// The single row tooltip: the frozen list label and the artist, joined only when both read.
// Uses listLabel (not meta.title) so it matches the row, and falls back to the "no artist"
// placeholder the row itself shows.
function rowTooltip(t: TrackItem, tr: (key: string) => string): string {
  const artist = t.meta.artist || tr('trackList.noArtist')
  return `${t.listLabel} — ${artist}`
}

interface RowProps {
  track: TrackItem
  selected: boolean
  primary: boolean
  // Whether this row holds the listbox's single tab stop (roving tabindex): the primary
  // row, or the first row while nothing is selected yet.
  tabbable: boolean
  // aria-setsize/posinset for the option, so a screen reader announces "row N of M".
  setSize: number
  posInSet: number
  outputFormat: OutputFormat
  onSelect: (id: string, mods: ClickMods) => void
  onActivate: (track: TrackItem) => void
  onRemove: (id: string) => void
  // Plain ⌫/Supr on the focused row — the keyboard ✕. Separate from onRemove because
  // the list must also hop selection/focus to a surviving neighbour (see TrackList).
  onRemoveKey: (id: string) => void
  onPrefetch: (id: string) => void
  onOpenMenu: (track: TrackItem, x: number, y: number) => void
  // Starts the native drag-out for this row (all selected files when it's part of the
  // selection, just this one otherwise). Stable, so the memoized rows don't re-render.
  onDragOut: (track: TrackItem) => void
  // Registers the row with the list's shared IntersectionObserver; returns the
  // unobserve cleanup. Undefined when the list doesn't track visibility.
  observeRow?: (el: Element, onVisible: (visible: boolean) => void) => () => void
  onVisible?: (id: string, visible: boolean) => void
  rowRegistry?: RefObject<Map<string, HTMLButtonElement>>
}

// Memoized so a progress event — which replaces only the updated track's object
// while every other row keeps its identity — re-renders that one row instead of
// the whole list. Relies on App passing stable onSelect/onRemove.
const TrackRow = memo(function TrackRow({
  track: t,
  selected,
  primary,
  tabbable,
  setSize,
  posInSet,
  outputFormat,
  onSelect,
  onActivate,
  onRemove,
  onRemoveKey,
  onPrefetch,
  onOpenMenu,
  onDragOut,
  observeRow,
  onVisible,
  rowRegistry,
}: RowProps): React.JSX.Element {
  const { t: tr } = useTranslation()
  const quality = trackQuality(t)
  // isStale JSON.stringifies the track's meta and beatgrid; computing it once per row and
  // threading it to the badge and the tooltip avoids paying that serialization twice on
  // every render of a converted row.
  const stale = isStale(t)
  // Source format read off the input path — the parsed fileName drops its extension —
  // so a mixed crate (WAV rips next to bought MP3s) can be scanned for what still
  // needs a conversion without opening each track. Shared with the per-format filter
  // and sort, so the pill, the filter chip and the sort order all agree.
  const format = sourceFormat(t)
  const rowRef = useRef<HTMLDivElement>(null)
  // Report this row entering/leaving the scroll pane so App can run auto-match for
  // what's on screen, through the list's single shared observer.
  useEffect(() => {
    const el = rowRef.current
    if (!onVisible || !observeRow || !el) return
    return observeRow(el, (visible) => onVisible(t.id, visible))
  }, [t.id, onVisible, observeRow])
  // Every selected row gets the soft fill; only the primary (the one in the editor)
  // wears the accent bar, so a multi-selection still shows which track is being edited.
  return (
    // Drag lives on the row wrapper, not the button: Chromium won't reliably start a native
    // drag from a <button> (its press state swallows the dragstart), so the row could
    // not be picked up at all. The img-based cover never hit this, hence the divergence.
    // biome-ignore lint/a11y/noStaticElementInteractions: the drag must live on the row wrapper (Chromium won't start a native drag from a button); the row's interactive semantics are on the inner role="option" button
    <div
      ref={rowRef}
      // Presentational: the listbox semantics live on the button below (role="option"),
      // so the drag-hosting wrapper drops out of the accessibility tree.
      role="presentation"
      // content-visibility lets the browser skip layout, paint and style for rows
      // scrolled out of the pane, so a 500-track crate doesn't pay that cost for the
      // ~490 rows off screen. The row stays in the DOM — unlike windowing — so keyboard
      // focus, the shared visibility observer and the rowEls measuring all keep working
      // untouched. contain-intrinsic-size feeds the scrollbar a height estimate for the
      // skipped rows; `auto` then remembers each row's real size once it has rendered.
      className="group relative [content-visibility:auto] [contain-intrinsic-size:auto_48px]"
      draggable
      onDragStart={(e) => {
        // Hand the OS the untouched source file(s) so the row can be dropped onto Spek
        // or any app. An actual drag suppresses the click, so select and drag-out
        // don't fight (same arrangement the cover uses). The cover rides along so the
        // OS drag thumbnail is the track's own art, not a generic app icon.
        e.preventDefault()
        onDragOut(t)
      }}
    >
      <button
        type="button"
        ref={(el) => {
          if (!rowRegistry) return
          if (el) rowRegistry.current.set(t.id, el)
          else rowRegistry.current.delete(t.id)
        }}
        data-testid="track-row"
        role="option"
        aria-selected={selected}
        // The rows are real DOM (content-visibility, not windowing), but a screen reader
        // still benefits from an explicit "row 12 of 500" as filters shrink the set.
        aria-setsize={setSize}
        aria-posinset={posInSet}
        // Roving tabindex: only the tab-stop row is reachable by Tab; the rest are driven
        // by the global ↑/↓ (and j/k) handler that focuses them as the selection moves.
        tabIndex={tabbable ? 0 : -1}
        onClick={(e) => onSelect(t.id, { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey })}
        onKeyDown={(e) => {
          // Bare key only: ⌘⌫ belongs to the global remove command, and the list is a
          // no-typing surface so plain ⌫/Supr is unambiguous here.
          if (e.key !== 'Backspace' && e.key !== 'Delete') return
          if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
          e.preventDefault()
          onRemoveKey(t.id)
        }}
        onDoubleClick={() => onActivate(t)}
        onContextMenu={(e) => {
          e.preventDefault()
          // Make the right-clicked row the editor's track unless it's already part of
          // the current selection, so the menu's single-track actions are unambiguous.
          if (!selected) onSelect(t.id, {})
          onOpenMenu(t, e.clientX, e.clientY)
        }}
        onMouseEnter={() => onPrefetch(t.id)}
        onFocus={() => onPrefetch(t.id)}
        className={`relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors ${
          selected
            ? 'bg-[var(--color-accent-soft)]/85'
            : 'bg-[var(--color-panel)]/50 hover:bg-[var(--color-panel-2)]/85'
        } ${
          primary
            ? 'before:absolute before:top-1/2 before:left-0 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-[var(--color-accent)]'
            : ''
        }`}
      >
        {/* The cover doubles as the scan target — DJs recognise a track by its art faster
            than by its name — so the leading slot shows the artwork with the processing
            status demoted to a small ringed dot on its corner. */}
        <span data-testid="track-status" className="group/dot relative shrink-0">
          {t.embeddedCover ? (
            <img
              data-testid="track-cover"
              src={t.embeddedCover}
              alt=""
              className="h-8 w-8 rounded-md object-cover outline outline-1 -outline-offset-1 outline-white/10"
            />
          ) : (
            <span
              data-testid="track-cover-placeholder"
              className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--color-panel-2)] outline outline-1 -outline-offset-1 outline-white/10"
            >
              <Music className="h-4 w-4 text-fg-faint" aria-hidden="true" />
            </span>
          )}
          <StatusBadge track={t} stale={stale} />
          <Tooltip
            label={tr(stale ? 'trackList.status.stale' : `trackList.status.${t.status}`)}
            align="start"
            scope="dot"
          />
        </span>
        {/* One tooltip for the whole text block (title + artist): two nested tooltips could
            both show as the pointer crossed between the stacked lines. It reveals the row's
            own label and artist — the frozen listLabel, not the editable meta.title, so it
            matches what the row shows. */}
        <span data-fit className="relative min-w-0 flex-1">
          <Tooltip label={rowTooltip(t, tr)} />
          <span className="block truncate text-sm font-medium text-fg">{t.listLabel}</span>
          {t.loadingMeta ? (
            <span
              data-testid="track-loading"
              className="mt-2 block h-2.5 w-28 animate-pulse rounded bg-[var(--color-panel-2)]"
            />
          ) : t.status === 'processing' && t.stage ? (
            <span data-testid="track-stage" className="mt-1 block">
              <span className="block truncate text-xs text-[var(--color-accent)]">
                {tr(`trackList.stage.${t.stage}`, {
                  format: (t.format ?? outputFormat).toUpperCase(),
                })}
              </span>
              <span className="mt-1 block h-1 overflow-hidden rounded-full bg-[var(--color-panel-2)]">
                <span
                  className="block h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-500 animate-pulse"
                  style={{ width: `${STAGE_PROGRESS[t.stage] * 100}%` }}
                />
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-fg-dim">
                {t.meta.artist || tr('trackList.noArtist')}
              </span>
              {/* A failed tag read leaves the row showing only its file-name parse; the mark
                  tells that apart from a file that genuinely carries no tags. Lives in the
                  flexible artist area so the reserved indicator columns don't shift. */}
              {t.metaReadFailed && (
                <span
                  data-testid="track-meta-failed"
                  className="group/dot relative flex shrink-0 items-center text-warn"
                >
                  <TriangleAlert className="h-3 w-3" aria-hidden="true" />
                  <Tooltip label={tr('trackList.metaReadFailed')} align="end" scope="dot" />
                </span>
              )}
              {/* Both indicators reserve a fixed-width slot even when absent, so the FLAC
                  badge and duration line up in the same column down every row instead of
                  shifting whenever a track lacks a sparkle or a quality verdict. */}
              <span className="flex w-3 shrink-0 justify-center">
                {t.autoMatched ? (
                  <span
                    data-testid="track-automatched"
                    data-confidence="high"
                    className="group/dot relative flex items-center text-[var(--color-accent)]"
                  >
                    <Sparkles className="h-3 w-3" aria-hidden="true" />
                    <Tooltip
                      label={matchTooltip(tr('trackList.autoMatched'), t.matchConfidence)}
                      align="end"
                      scope="dot"
                    />
                  </span>
                ) : (
                  // A review-tier suggestion the user hasn't acted on yet: amber, distinct from
                  // the applied accent sparkle, and gone the moment the track is actually matched.
                  t.matchReview &&
                  !t.matched && (
                    <span
                      data-testid="track-match-review"
                      data-confidence="review"
                      className="group/dot relative flex items-center text-warn"
                    >
                      <Sparkles className="h-3 w-3" aria-hidden="true" />
                      <Tooltip
                        label={matchTooltip(tr('trackList.matchReview'), t.matchConfidence)}
                        align="end"
                        scope="dot"
                      />
                    </span>
                  )
                )}
              </span>
              <span className="flex w-3 shrink-0 justify-center">
                {quality !== 'unanalyzed' ? (
                  <QualityMark verdict={quality} label={tr(qualityLabel[quality])} />
                ) : (
                  t.analyzing && (
                    <span
                      data-testid="track-quality-loading"
                      className="group/dot relative h-2 w-2 animate-pulse rounded-full bg-fg-faint ring-2 ring-fg-faint/20"
                    >
                      <Tooltip label={tr('editor.analyzing')} align="end" scope="dot" />
                    </span>
                  )
                )}
              </span>
              {format && (
                <span
                  data-testid="track-format"
                  className="shrink-0 rounded border border-[var(--color-line-strong)] px-1 text-[10px] font-medium leading-4 text-fg-dim"
                >
                  {format}
                </span>
              )}
              {t.duration !== undefined && (
                <span
                  data-testid="track-duration"
                  className="shrink-0 text-xs tabular-nums text-fg-dim"
                >
                  {formatTime(t.duration)}
                </span>
              )}
            </span>
          )}
        </span>
      </button>
      {/* A ▶ overlay over the cover makes play discoverable — double-click and Space are
          the only other ways in, and neither shows itself. A sibling of the row button
          (not a child) so it stays a valid nested-button-free control, like remove. */}
      <button
        type="button"
        aria-label={tr('player.play')}
        onClick={() => onActivate(t)}
        className="absolute top-1/2 left-3 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md bg-black/55 text-white opacity-0 backdrop-blur-[1px] transition-opacity pointer-events-none hover:bg-black/70 group-hover:pointer-events-auto group-hover:opacity-100"
      >
        <Play className="h-4 w-4 fill-current" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={tr('trackList.remove')}
        onClick={() => onRemove(t.id)}
        className="absolute top-1/2 right-1.5 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--color-panel-2)]/60 text-fg-dim opacity-0 shadow-md ring-1 ring-[var(--color-line-strong)] backdrop-blur-sm transition-opacity pointer-events-none hover:bg-[var(--color-panel-2)] hover:text-fg group-hover:pointer-events-auto group-hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  )
})

// Memoized so App re-renders (a toast, a progress tick, a modal open) that don't
// touch the visible tracks skip re-mapping and re-diffing every row — the rows
// themselves are already memoized (see TrackRow above), but without this the list
// still re-ran its full render body on every App render. Relies on every function
// prop below being stable (App/useTrackLibrary/useAutoMatch use useStableCallback
// or a dependency-correct useCallback for all of them).
export const TrackList = memo(function TrackList({
  tracks,
  selectedId,
  selectedIds,
  outputFormat,
  onSelect,
  onActivate,
  onRemove,
  onPrefetch,
  onSearch,
  onStartOver,
  onCopyMeta,
  onCopyPath,
  onPasteMeta,
  canPasteMeta,
  onTrash,
  scrollRootRef,
  onVisible,
  rowRegistry,
}: Props): React.JSX.Element {
  const [menu, setMenu] = useState<MenuState | null>(null)
  // The keyboard ✕ (plain ⌫/Supr on a focused row). Removal deselects, which would
  // strand the keyboard on a dead row: hop selection — and focus, via the registry —
  // to the first row OUTSIDE the doomed set (onRemove is selection-aware in App), so
  // ⌫ ⌫ ⌫ walks down the list like Finder's delete does.
  const removeViaKeyboard = useStableCallback((id: string): void => {
    const doomed = selectedIds.has(id) ? selectedIds : new Set([id])
    const i = tracks.findIndex((t) => t.id === id)
    const neighbor =
      tracks.slice(i + 1).find((t) => !doomed.has(t.id)) ??
      tracks
        .slice(0, Math.max(i, 0))
        .reverse()
        .find((t) => !doomed.has(t.id))
    onRemove(id)
    if (neighbor) {
      onSelect(neighbor.id, {})
      rowRegistry?.current?.get(neighbor.id)?.focus()
    }
  })
  // Stable so the memoized rows don't all re-render when the menu opens/closes.
  const openMenu = useCallback(
    (track: TrackItem, x: number, y: number) => setMenu({ track, x, y }),
    [],
  )
  // Reads the live selection at drag time through a ref, so the handler stays stable and
  // the memoized rows don't all re-render whenever the selection changes.
  const dragState = useRef({ tracks, selectedIds })
  dragState.current = { tracks, selectedIds }
  const startDragOut = useCallback((track: TrackItem): void => {
    const { tracks, selectedIds } = dragState.current
    // Dragging a row that's part of the selection drags the whole selection (Finder's
    // convention); dragging an unselected row drags just that one. List order is kept.
    const paths = selectedIds.has(track.id)
      ? tracks.filter((t) => selectedIds.has(t.id)).map((t) => t.inputPath)
      : [track.inputPath]
    // The OS drag thumbnail is the file's own art, matching the row — never the cover
    // the user dropped into the editor form, which lives on the live coverUrl.
    window.api.startTrackDrag(paths, track.embeddedCover)
  }, [])
  // One IntersectionObserver for the whole list instead of one per row — 500 rows
  // used to mean 500 observer instances doing identical work against the same root.
  // Created lazily on the first row registration so the scroll pane's ref is bound;
  // rootMargin warms rows a little before they're scrolled fully into view.
  const rowVisibility = useRef(new Map<Element, (visible: boolean) => void>())
  const rowObserver = useRef<IntersectionObserver | null>(null)
  const observeRow = useCallback(
    (el: Element, report: (visible: boolean) => void): (() => void) => {
      if (typeof IntersectionObserver === 'undefined') return () => {}
      if (!rowObserver.current) {
        rowObserver.current = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              rowVisibility.current.get(entry.target)?.(entry.isIntersecting)
            }
          },
          { root: scrollRootRef?.current ?? null, rootMargin: '300px 0px' },
        )
      }
      rowVisibility.current.set(el, report)
      rowObserver.current.observe(el)
      return () => {
        rowVisibility.current.delete(el)
        rowObserver.current?.unobserve(el)
      }
    },
    [scrollRootRef],
  )
  useEffect(() => () => rowObserver.current?.disconnect(), [])
  const { t: tr } = useTranslation()
  return (
    <>
      <div
        role="listbox"
        aria-label={tr('trackList.label')}
        aria-multiselectable="true"
        className="flex flex-col gap-1 p-2"
      >
        {tracks.map((t, i) => (
          <TrackRow
            key={t.id}
            track={t}
            selected={selectedIds.has(t.id)}
            primary={t.id === selectedId}
            // The selection owns the single tab stop; with nothing selected the first row
            // holds it so the list stays reachable by Tab.
            tabbable={t.id === selectedId || (selectedId === null && i === 0)}
            setSize={tracks.length}
            posInSet={i + 1}
            outputFormat={outputFormat}
            onSelect={onSelect}
            onActivate={onActivate}
            onRemove={onRemove}
            onRemoveKey={removeViaKeyboard}
            onPrefetch={onPrefetch}
            onOpenMenu={openMenu}
            onDragOut={startDragOut}
            observeRow={observeRow}
            onVisible={onVisible}
            rowRegistry={rowRegistry}
          />
        ))}
      </div>
      {menu && (
        <TrackContextMenu
          track={menu.track}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onSearch={onSearch}
          onStartOver={onStartOver}
          onCopyMeta={onCopyMeta}
          onCopyPath={onCopyPath}
          onPasteMeta={onPasteMeta}
          canPasteMeta={canPasteMeta}
          onRemove={onRemove}
          onTrash={onTrash}
        />
      )}
    </>
  )
})
