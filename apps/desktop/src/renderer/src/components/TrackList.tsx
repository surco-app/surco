import type React from 'react'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OutputFormat } from '../../../shared/types'
import { formatTime } from '../lib/duration'
import { STAGE_PROGRESS } from '../lib/progress'
import type { ClickMods } from '../lib/selection'
import type { TrackItem, TrackStatus } from '../types'
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
}: RowProps): React.JSX.Element {
  const { t: tr } = useTranslation()
  // Every selected row gets the soft fill; only the primary (the one in the editor)
  // wears the accent bar, so a multi-selection still shows which track is being edited.
  return (
    <li className="group relative">
      <button
        type="button"
        data-testid="track-row"
        aria-selected={selected}
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
        className={`relative flex w-full items-center gap-3 rounded-lg py-2.5 pr-10 pl-3 text-left transition-colors ${
          selected ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-panel-2)]'
        } ${
          primary
            ? 'before:absolute before:top-1/2 before:left-0 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-[var(--color-accent)]'
            : ''
        }`}
      >
        <span
          title={tr(`trackList.status.${t.status}`)}
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusColor[t.status]}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">
            {t.meta.title || t.fileName}
          </span>
          {t.status === 'processing' && t.stage ? (
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
        className="absolute top-1/2 right-2 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-fg-dim transition-colors hover:bg-[var(--color-line-strong)] hover:text-fg group-hover:flex"
      >
        ✕
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
