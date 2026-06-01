import type React from 'react'
import type { TrackItem, TrackStatus } from '../types'

interface Props {
  tracks: TrackItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}

const statusColor: Record<TrackStatus, string> = {
  idle: 'bg-neutral-600',
  processing: 'bg-amber-400 animate-pulse',
  done: 'bg-emerald-400',
  error: 'bg-red-500'
}

const statusLabel: Record<TrackStatus, string> = {
  idle: 'Pendiente',
  processing: 'Procesando…',
  done: 'Hecho',
  error: 'Error'
}

export function TrackList({ tracks, selectedId, onSelect, onRemove }: Props): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-1 p-2">
      {tracks.map((t) => {
        const active = t.id === selectedId
        return (
          <li key={t.id}>
            <button
              data-testid="track-row"
              onClick={() => onSelect(t.id)}
              className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                active ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-panel-2)]'
              }`}
            >
              <span
                title={statusLabel[t.status]}
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusColor[t.status]}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-neutral-100">
                  {t.meta.title || t.fileName}
                </span>
                <span className="block truncate text-xs text-neutral-500">
                  {t.meta.artist || 'Sin artista'}
                </span>
              </span>
              <span
                role="button"
                aria-label="Quitar"
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(t.id)
                }}
                className="hidden shrink-0 rounded px-1.5 text-neutral-500 hover:text-neutral-200 group-hover:block"
              >
                ✕
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
