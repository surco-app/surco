import { Music, Sparkles, X } from 'lucide-react'
import type React from 'react'
import { memo, type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OutputFormat } from '../../../shared/types'
import { isStale } from '../lib/dirty'
import { formatTime } from '../lib/duration'
import { STAGE_PROGRESS } from '../lib/progress'
import type { Verdict } from '../lib/quality'
import type { ClickMods } from '../lib/selection'
import { trackQuality } from '../lib/triage'
import type { TrackItem, TrackStatus } from '../types'
import { Tooltip } from './Tooltip'
import { TrackContextMenu } from './TrackContextMenu'

interface Props {
  tracks: TrackItem[]
  selectedId: string | null
  selectedIds: string[]
  outputFormat: OutputFormat
  onSelect: (id: string, mods: ClickMods) => void
  onRemove: (id: string) => void
  onPrefetch: (id: string) => void
  onSearch: (id: string) => void
  onStartOver: (track: TrackItem) => void
  onCopyMeta: (track: TrackItem) => void
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

const statusColor: Record<TrackStatus, string> = {
  idle: 'bg-fg-faint',
  processing: 'bg-warn animate-pulse',
  done: 'bg-good',
  error: 'bg-danger',
}

const qualityDot: Record<Verdict, string> = {
  good: 'bg-good ring-good/20',
  warn: 'bg-warn ring-warn/20',
  bad: 'bg-danger ring-danger/20',
  processed: 'bg-danger ring-danger/20',
}

const qualityLabel: Record<Verdict, string> = {
  good: 'editor.qualityGood',
  warn: 'editor.qualitySuspect',
  bad: 'editor.qualityBad',
  processed: 'editor.qualityProcessed',
}

interface RowProps {
  track: TrackItem
  selected: boolean
  primary: boolean
  outputFormat: OutputFormat
  onSelect: (id: string, mods: ClickMods) => void
  onRemove: (id: string) => void
  onPrefetch: (id: string) => void
  onOpenMenu: (track: TrackItem, x: number, y: number) => void
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
  outputFormat,
  onSelect,
  onRemove,
  onPrefetch,
  onOpenMenu,
  observeRow,
  onVisible,
  rowRegistry,
}: RowProps): React.JSX.Element {
  const { t: tr } = useTranslation()
  const quality = trackQuality(t)
  // Source format read off the input path — the parsed fileName drops its extension —
  // so a mixed crate (WAV rips next to bought MP3s) can be scanned for what still
  // needs a conversion without opening each track.
  const sourceFormat = /\.([^./]+)$/.exec(t.inputPath)?.[1]?.toUpperCase()
  const rowRef = useRef<HTMLLIElement>(null)
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
    // Drag lives on the <li>, not the button: Chromium won't reliably start a native
    // drag from a <button> (its press state swallows the dragstart), so the row could
    // not be picked up at all. The img-based cover never hit this, hence the divergence.
    <li
      ref={rowRef}
      className="group relative"
      draggable
      onDragStart={(e) => {
        // Hand the OS the untouched source file so the row can be dropped onto Spek
        // or any app. An actual drag suppresses the click, so select and drag-out
        // don't fight (same arrangement the cover uses). The cover rides along so the
        // OS drag thumbnail is the track's own art, not a generic app icon.
        e.preventDefault()
        window.api.startTrackDrag(t.inputPath, t.coverUrl)
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
        aria-pressed={selected}
        onClick={(e) => onSelect(t.id, { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey })}
        onContextMenu={(e) => {
          e.preventDefault()
          // Make the right-clicked row the editor's track unless it's already part of
          // the current selection, so the menu's single-track actions are unambiguous.
          if (!selected) onSelect(t.id, {})
          onOpenMenu(t, e.clientX, e.clientY)
        }}
        onMouseEnter={() => onPrefetch(t.id)}
        onFocus={() => onPrefetch(t.id)}
        className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors ${
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
          {t.coverUrl ? (
            <img
              data-testid="track-cover"
              src={t.coverUrl}
              alt=""
              className="h-9 w-9 rounded-md object-cover outline outline-1 -outline-offset-1 outline-white/10"
            />
          ) : (
            <span
              data-testid="track-cover-placeholder"
              className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--color-panel-2)] outline outline-1 -outline-offset-1 outline-white/10"
            >
              <Music className="h-4 w-4 text-fg-faint" aria-hidden="true" />
            </span>
          )}
          {/* A done track edited afterwards shows amber (steady, unlike the processing
              pulse) so pending Updates stay visible and can safely be batched for later. */}
          <span
            className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--color-panel)] ${
              isStale(t) ? 'bg-warn' : statusColor[t.status]
            }`}
          />
          <Tooltip
            label={tr(isStale(t) ? 'trackList.status.stale' : `trackList.status.${t.status}`)}
            align="start"
            scope="dot"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span data-fit title={t.listLabel} className="block truncate text-sm font-medium text-fg">
            {t.listLabel}
          </span>
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
              <span
                data-fit
                title={t.meta.artist || tr('trackList.noArtist')}
                className="min-w-0 flex-1 truncate text-xs text-fg-dim"
              >
                {t.meta.artist || tr('trackList.noArtist')}
              </span>
              {t.autoMatched && (
                <span
                  data-testid="track-automatched"
                  className="group/dot relative flex shrink-0 items-center text-[var(--color-accent)]"
                >
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  <Tooltip label={tr('trackList.autoMatched')} align="end" scope="dot" />
                </span>
              )}
              {quality !== 'unanalyzed' ? (
                <span
                  data-testid="track-quality"
                  data-quality={quality}
                  className={`group/dot relative h-2 w-2 shrink-0 rounded-full ring-2 ${qualityDot[quality]}`}
                >
                  <Tooltip label={tr(qualityLabel[quality])} align="end" scope="dot" />
                </span>
              ) : (
                t.analyzing && (
                  <span
                    data-testid="track-quality-loading"
                    className="group/dot relative h-2 w-2 shrink-0 animate-pulse rounded-full bg-fg-faint ring-2 ring-fg-faint/20"
                  >
                    <Tooltip label={tr('editor.analyzing')} align="end" scope="dot" />
                  </span>
                )
              )}
              {sourceFormat && (
                <span
                  data-testid="track-format"
                  className="shrink-0 rounded border border-[var(--color-line-strong)] px-1 text-[10px] font-medium leading-4 text-fg-dim"
                >
                  {sourceFormat}
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
      <button
        type="button"
        aria-label={tr('trackList.remove')}
        onClick={() => onRemove(t.id)}
        className="absolute top-1/2 right-1.5 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--color-panel-2)]/60 text-fg-dim opacity-0 shadow-md ring-1 ring-[var(--color-line-strong)] backdrop-blur-sm transition-opacity pointer-events-none hover:bg-[var(--color-panel-2)] hover:text-fg group-hover:pointer-events-auto group-hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </li>
  )
})

export function TrackList({
  tracks,
  selectedId,
  selectedIds,
  outputFormat,
  onSelect,
  onRemove,
  onPrefetch,
  onSearch,
  onStartOver,
  onCopyMeta,
  onPasteMeta,
  canPasteMeta,
  onTrash,
  scrollRootRef,
  onVisible,
  rowRegistry,
}: Props): React.JSX.Element {
  const [menu, setMenu] = useState<MenuState | null>(null)
  // Stable so the memoized rows don't all re-render when the menu opens/closes.
  const openMenu = useCallback(
    (track: TrackItem, x: number, y: number) => setMenu({ track, x, y }),
    [],
  )
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
  return (
    <ul className="flex flex-col gap-1 p-2">
      {tracks.map((t) => (
        <TrackRow
          key={t.id}
          track={t}
          selected={selectedIds.includes(t.id)}
          primary={t.id === selectedId}
          outputFormat={outputFormat}
          onSelect={onSelect}
          onRemove={onRemove}
          onPrefetch={onPrefetch}
          onOpenMenu={openMenu}
          observeRow={observeRow}
          onVisible={onVisible}
          rowRegistry={rowRegistry}
        />
      ))}
      {menu && (
        <TrackContextMenu
          track={menu.track}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onSearch={onSearch}
          onStartOver={onStartOver}
          onCopyMeta={onCopyMeta}
          onPasteMeta={onPasteMeta}
          canPasteMeta={canPasteMeta}
          onRemove={onRemove}
          onTrash={onTrash}
        />
      )}
    </ul>
  )
}
