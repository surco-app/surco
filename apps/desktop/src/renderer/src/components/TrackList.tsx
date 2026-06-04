import type React from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { OutputFormat } from '../../../shared/types'
import { formatTime } from '../lib/duration'
import { STAGE_PROGRESS } from '../lib/progress'
import type { TrackItem, TrackStatus } from '../types'

interface Props {
  tracks: TrackItem[]
  selectedId: string | null
  outputFormat: OutputFormat
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}

const statusColor: Record<TrackStatus, string> = {
  idle: 'bg-fg-faint',
  processing: 'bg-warn animate-pulse',
  done: 'bg-good',
  error: 'bg-danger',
}

interface RowProps {
  track: TrackItem
  active: boolean
  outputFormat: OutputFormat
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}

// Memoized so a progress event — which replaces only the updated track's object
// while every other row keeps its identity — re-renders that one row instead of
// the whole list. Relies on App passing stable onSelect/onRemove.
const TrackRow = memo(function TrackRow({
  track: t,
  active,
  outputFormat,
  onSelect,
  onRemove,
}: RowProps): React.JSX.Element {
  const { t: tr } = useTranslation()
  return (
    <li className="group relative">
      <button
        type="button"
        data-testid="track-row"
        onClick={() => onSelect(t.id)}
        className={`relative flex w-full items-center gap-3 rounded-lg py-2.5 pr-10 pl-3 text-left transition-colors ${
          active
            ? 'bg-[var(--color-accent-soft)] before:absolute before:top-1/2 before:left-0 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-[var(--color-accent)]'
            : 'hover:bg-[var(--color-panel-2)]'
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
                {tr(`trackList.stage.${t.stage}`, { format: outputFormat.toUpperCase() })}
              </span>
              <span className="mt-1 block h-1 overflow-hidden rounded-full bg-[var(--color-panel-2)]">
                <span
                  className="block h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-500 animate-pulse"
                  style={{ width: `${STAGE_PROGRESS[t.stage] * 100}%` }}
                />
              </span>
            </span>
          ) : (
            <span className="block truncate text-xs text-fg-dim">
              {t.meta.artist || tr('trackList.noArtist')}
            </span>
          )}
        </span>
        {t.duration !== undefined && (
          <span data-testid="track-duration" className="shrink-0 text-xs tabular-nums text-fg-dim">
            {formatTime(t.duration)}
          </span>
        )}
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
  outputFormat,
  onSelect,
  onRemove,
}: Props): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-1 p-2">
      {tracks.map((t) => (
        <TrackRow
          key={t.id}
          track={t}
          active={t.id === selectedId}
          outputFormat={outputFormat}
          onSelect={onSelect}
          onRemove={onRemove}
        />
      ))}
    </ul>
  )
}
