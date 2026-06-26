import {
  AlertCircle,
  CheckCircle2,
  Disc3,
  Image as ImageIcon,
  Loader2,
  Music,
  Radio,
  Trash2,
  X,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useRef, useState } from 'react'
import type { ActivityKind } from '../../../shared/types'
import type { ActivityRow } from '../lib/activityLog'

interface Props {
  rows: ActivityRow[]
  onClear: () => void
  onClose: () => void
}

// A per-kind glyph so the feed reads at a glance which subsystem is working —
// a turntable for Discogs, a Bandcamp note, an image for cover downloads, a disc
// for conversions. Defensive default keeps a future kind from rendering blank.
const KIND_ICON: Record<ActivityKind, typeof Disc3> = {
  discogs: Disc3,
  bandcamp: Music,
  cover: ImageIcon,
  convert: Disc3,
}

function StatusIcon({ status }: { status: ActivityRow['status'] }): React.JSX.Element {
  if (status === 'running')
    return (
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-fg-muted" aria-hidden="true" />
    )
  if (status === 'error')
    return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" aria-hidden="true" />
  return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
}

function Row({ row }: { row: ActivityRow }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const Icon = KIND_ICON[row.kind] ?? Radio
  const expandable = Boolean(row.detail)
  return (
    <li className="border-b border-[var(--color-line)] last:border-0">
      <button
        type="button"
        data-testid="activity-row"
        disabled={!expandable}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left enabled:hover:bg-[var(--color-panel-2)] disabled:cursor-default"
      >
        <StatusIcon status={row.status} />
        <Icon className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs text-fg">{row.label}</span>
        {row.ms !== undefined && (
          <span className="shrink-0 font-mono text-[10px] text-fg-muted">{row.ms} ms</span>
        )}
      </button>
      {open && row.detail && (
        <pre
          data-testid="activity-row-detail"
          className="max-h-32 overflow-auto whitespace-pre-wrap break-all px-3 pb-2 pl-9 font-mono text-[10px] text-fg-muted"
        >
          {row.detail}
        </pre>
      )}
    </li>
  )
}

// A floating, freely-positioned activity log: a movable card that surfaces what
// Surco is doing under the hood (each Discogs/Bandcamp search, cover download and
// conversion) as a live, human-readable feed, with the technical detail one click
// away. Dragged by its header; position is local component state (Phase 1 doesn't
// persist it). Rendered inside the window, not a separate OS window.
export function ActivityPanel({ rows, onClear, onClose }: Props): React.JSX.Element {
  const [pos, setPos] = useState({ x: 24, y: 80 })
  const drag = useRef<{ dx: number; dy: number } | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [pos],
  )
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return
    // Clamp to the viewport so the card can never be dragged fully off-screen and
    // become unreachable (its header must stay grabbable).
    const x = Math.max(0, Math.min(window.innerWidth - 120, e.clientX - drag.current.dx))
    const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.current.dy))
    setPos({ x, y })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    drag.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }, [])

  return (
    <div
      data-testid="activity-panel"
      className="fixed z-50 flex max-h-[60vh] w-80 flex-col overflow-hidden rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] shadow-2xl"
      style={{ left: pos.x, top: pos.y }}
    >
      <header
        data-testid="activity-panel-handle"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="flex cursor-grab items-center gap-2 border-b border-[var(--color-line)] px-3 py-2 active:cursor-grabbing"
      >
        <Radio className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden="true" />
        <span className="flex-1 select-none text-xs font-medium text-fg">Actividad</span>
        <button
          type="button"
          data-testid="activity-clear"
          aria-label="Vaciar"
          onClick={onClear}
          className="press flex h-6 w-6 items-center justify-center rounded-md text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="activity-close"
          aria-label="Cerrar"
          onClick={onClose}
          className="press flex h-6 w-6 items-center justify-center rounded-md text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </header>
      {rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-fg-muted">Sin actividad todavía</p>
      ) : (
        <ul className="overflow-auto">
          {rows.map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </ul>
      )}
    </div>
  )
}
