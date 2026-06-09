import { Sparkles, X } from 'lucide-react'
import type React from 'react'
import { memo, type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OutputFormat } from '../../../shared/types'
import { formatTime } from '../lib/duration'
import { STAGE_PROGRESS } from '../lib/progress'
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
  onTrash: (track: TrackItem) => void
  // Optional viewport tracking: the scroll pane each row observes against and a callback
  // reporting when a row enters or leaves it, so App can gate auto-match to the rows on screen.
  scrollRootRef?: RefObject<HTMLElement | null>
  onVisible?: (id: string, visible: boolean) => void
}

type MenuState = { track: TrackItem; x: number; y: number }

const statusColor: Record<TrackStatus, string> = {
  idle: 'bg-fg-faint',
  processing: 'bg-warn animate-pulse',
  done: 'bg-good',
  error: 'bg-danger',
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
  scrollRootRef?: RefObject<HTMLElement | null>
  onVisible?: (id: string, visible: boolean) => void
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
  scrollRootRef,
  onVisible,
}: RowProps): React.JSX.Element {
  const { t: tr } = useTranslation()
  const quality = trackQuality(t)
  const rowRef = useRef<HTMLLIElement>(null)
  // Report this row entering/leaving the scroll pane so App can run auto-match for what's on
  // screen. rootMargin warms rows a little before they're scrolled fully into view.
  useEffect(() => {
    const el = rowRef.current
    if (!onVisible || !el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) onVisible(t.id, entry.isIntersecting)
      },
      { root: scrollRootRef?.current ?? null, rootMargin: '300px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [t.id, onVisible, scrollRootRef])
  // Every selected row gets the soft fill; only the primary (the one in the editor)
  // wears the accent bar, so a multi-selection still shows which track is being edited.
  return (
    <li ref={rowRef} className="group relative">
      <button
        type="button"
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
        className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left backdrop-blur-sm transition-colors ${
          selected ? 'bg-[var(--color-accent-soft)]/85' : 'hover:bg-[var(--color-panel-2)]/85'
        } ${
          primary
            ? 'before:absolute before:top-1/2 before:left-0 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-[var(--color-accent)]'
            : ''
        }`}
      >
        <span
          className={`group/dot relative h-2.5 w-2.5 shrink-0 rounded-full ${statusColor[t.status]}`}
        >
          <Tooltip label={tr(`trackList.status.${t.status}`)} align="start" scope="dot" />
        </span>
        <span className="min-w-0 flex-1">
          <span data-fit className="block truncate text-sm font-medium text-fg">
            {t.listLabel}
          </span>
          {t.loadingMeta ? (
            <span
              data-testid="track-loading"
              className="mt-1.5 block h-3 w-28 animate-pulse rounded bg-[var(--color-panel-2)]"
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
              <span data-fit className="min-w-0 flex-1 truncate text-xs text-fg-dim">
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
              {quality !== 'unanalyzed' && (
                <span
                  data-testid="track-quality"
                  data-quality={quality}
                  className={`group/dot relative h-1.5 w-1.5 shrink-0 rounded-full ${
                    quality === 'suspect' ? 'bg-warn' : 'bg-good'
                  }`}
                >
                  <Tooltip
                    label={tr(quality === 'good' ? 'editor.qualityGood' : 'editor.qualitySuspect')}
                    align="end"
                    scope="dot"
                  />
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
  onTrash,
  scrollRootRef,
  onVisible,
}: Props): React.JSX.Element {
  const [menu, setMenu] = useState<MenuState | null>(null)
  // Stable so the memoized rows don't all re-render when the menu opens/closes.
  const openMenu = useCallback(
    (track: TrackItem, x: number, y: number) => setMenu({ track, x, y }),
    [],
  )
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
          scrollRootRef={scrollRootRef}
          onVisible={onVisible}
        />
      ))}
      {menu && (
        <TrackContextMenu
          track={menu.track}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onSearch={onSearch}
          onRemove={onRemove}
          onTrash={onTrash}
        />
      )}
    </ul>
  )
}
