import {
  Activity as ActivityIcon,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Disc3,
  ExternalLink,
  FileOutput,
  FolderDown,
  Image as ImageIcon,
  Library,
  Loader2,
  Music,
  Radio,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ActivityKind } from '../../../shared/types'
import type { ActivityRow } from '../lib/activityLog'
import { MIN_HEIGHT, MIN_WIDTH, type PanelGeometry } from '../lib/panelGeometry'

type Translate = ReturnType<typeof useTranslation>['t']

// Resolves a row's translatable text: a key wins (translated with its params), else
// the raw fallback (a file name, release title, URL, error) passes through verbatim.
function rowLabel(tr: Translate, row: ActivityRow): string {
  if (row.labelKey) return tr(row.labelKey, row.labelParams)
  return row.label ?? ''
}
function rowDetail(tr: Translate, row: ActivityRow): string | undefined {
  if (row.detailKey) return tr(row.detailKey, row.detailParams)
  return row.detail
}

interface Props {
  rows: ActivityRow[]
  onClear: () => void
  onClose: () => void
  // The parked position/size restored from settings (already clamped by App) and the
  // callback that persists it — fired when a drag or resize ends, never per move tick.
  geometry: PanelGeometry
  onGeometryChange: (g: PanelGeometry) => void
}

// A per-kind glyph so the feed reads at a glance which subsystem is working —
// a turntable for Discogs, a Bandcamp note, an image for cover downloads, a disc
// for conversions. Defensive default keeps a future kind from rendering blank.
const KIND_ICON: Record<ActivityKind, typeof Disc3> = {
  discogs: Disc3,
  bandcamp: Music,
  cover: ImageIcon,
  convert: Disc3,
  analyze: ActivityIcon,
  applemusic: Library,
  import: FolderDown,
  export: FileOutput,
  // The same sparkle the track list stamps on auto-matched rows, so the verdict entry
  // and the row it explains read as one feature.
  match: Sparkles,
}

function StatusIcon({ status }: { status: ActivityRow['status'] }): React.JSX.Element {
  if (status === 'running')
    return (
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-fg-muted" aria-hidden="true" />
    )
  if (status === 'error')
    return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
  return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-good" aria-hidden="true" />
}

// Opens a release/cover URL in the user's browser. window.open is routed to the OS
// browser by the main process's window-open handler (web links only), so the page
// never loads inside the app.
function openUrl(url: string): void {
  window.open(url)
}

const URL_SPLIT = /(https?:\/\/[^\s]+)/g
const IS_URL = /^https?:\/\//

// Renders a technical-detail line with any http(s) URL turned into a clickable link
// (the cover URL, the API endpoint), so the user can jump straight to the page. Plain
// text between URLs is preserved, including the raw error a failed step appended.
function DetailText({ text }: { text: string }): React.JSX.Element {
  const parts = text.split(URL_SPLIT)
  return (
    <>
      {parts.map((part, i) =>
        IS_URL.test(part) ? (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: split output is positional and stable for one render
            key={i}
            type="button"
            onClick={() => openUrl(part)}
            className="cursor-pointer break-all text-left text-[var(--color-accent)] underline hover:opacity-80"
          >
            {part}
          </button>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional, stable
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

// A leaf step inside an expanded group: its own status, label, timing and (when it
// failed or carries one) its technical detail line.
function ChildRow({ row }: { row: ActivityRow }): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  const detail = rowDetail(tr, row)
  const expandable = Boolean(detail)
  return (
    <li>
      <button
        type="button"
        data-testid="activity-child"
        disabled={!expandable}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 py-1 pr-3 pl-9 text-left enabled:hover:bg-[var(--color-panel-2)] disabled:cursor-default"
      >
        <StatusIcon status={row.status} />
        <span className="min-w-0 flex-1 truncate text-[11px] text-fg-muted">
          {rowLabel(tr, row)}
        </span>
        {row.ms !== undefined && (
          <span className="shrink-0 font-mono text-[10px] text-fg-muted">
            {tr('activity.elapsedMs', { ms: row.ms })}
          </span>
        )}
      </button>
      {open && detail && (
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all px-3 pb-2 pl-12 font-mono text-[10px] text-fg-muted">
          <DetailText text={detail} />
        </pre>
      )}
    </li>
  )
}

function Row({ row }: { row: ActivityRow }): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  const Icon = KIND_ICON[row.kind] ?? Radio
  const grouped = Boolean(row.children?.length)
  const detail = rowDetail(tr, row)
  const expandable = grouped || Boolean(detail)
  return (
    <li className="border-b border-[var(--color-line)] last:border-0">
      <div className="group flex items-center hover:bg-[var(--color-panel-2)]">
        <button
          type="button"
          data-testid="activity-row"
          disabled={!expandable}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left disabled:cursor-default"
        >
          <StatusIcon status={row.status} />
          <Icon className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-xs text-fg">{rowLabel(tr, row)}</span>
          {grouped && (
            <span className="shrink-0 text-[10px] text-fg-muted tabular-nums">
              {row.children?.filter((c) => c.status !== 'running').length}/{row.children?.length}
            </span>
          )}
          {row.ms !== undefined && (
            <span className="shrink-0 font-mono text-[10px] text-fg-muted">
            {tr('activity.elapsedMs', { ms: row.ms })}
          </span>
          )}
          {expandable && (
            <ChevronRight
              className={`h-3 w-3 shrink-0 text-fg-muted transition-transform ${open ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
          )}
        </button>
        {row.url && (
          <button
            type="button"
            data-testid="activity-open-url"
            aria-label={tr('activity.openInBrowser')}
            onClick={() => row.url && openUrl(row.url)}
            className="press mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-muted opacity-0 hover:bg-[var(--color-line-strong)] hover:text-fg group-hover:opacity-100"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      {open && grouped && (
        <ul className="border-t border-[var(--color-line)] bg-[var(--color-panel-2)]/40">
          {row.children?.map((c) => (
            <ChildRow key={c.id} row={c} />
          ))}
        </ul>
      )}
      {open && !grouped && detail && (
        <pre
          data-testid="activity-row-detail"
          className="max-h-32 overflow-auto whitespace-pre-wrap break-all px-3 pb-2 pl-9 font-mono text-[10px] text-fg-muted"
        >
          <DetailText text={detail} />
        </pre>
      )}
    </li>
  )
}

// A floating, freely-positioned activity log: a movable card that surfaces what
// Surco is doing under the hood (each Discogs/Bandcamp search, cover download and
// conversion) as a live, human-readable feed, with the technical detail one click
// away. Dragged by its header; geometry persists in localStorage (parsed and clamped
// by panelGeometry). Rendered inside the window, not a separate OS window.

export function ActivityPanel({
  rows,
  onClear,
  onClose,
  geometry,
  onGeometryChange,
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  // Seeded from the persisted geometry once per mount; local state while dragging so
  // a move never round-trips through the settings store per pointer tick.
  const [pos, setPos] = useState(geometry.pos)
  const [size, setSize] = useState(geometry.size)
  // Refs mirror the latest values because the pointer-up handlers deliberately have
  // no state deps.
  const posRef = useRef(pos)
  posRef.current = pos
  const sizeRef = useRef(size)
  sizeRef.current = size
  const persistGeometry = useCallback(() => {
    onGeometryChange({ pos: posRef.current, size: sizeRef.current })
  }, [onGeometryChange])
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const resize = useRef<{ x: number; y: number; width: number; height: number } | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Starting the drag captures the pointer for the whole header, which would
      // swallow the click on the clear/close buttons sitting inside it — so a press
      // that lands on a button is left alone and only bare-header presses drag.
      if ((e.target as HTMLElement).closest('button')) return
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
  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!drag.current) return
      drag.current = null
      e.currentTarget.releasePointerCapture(e.pointerId)
      persistGeometry()
    },
    [persistGeometry],
  )

  // The corner grip resizes both axes at once: it records the press origin and the
  // size then, and grows the card by the pointer's delta — floored at the minimums
  // and capped so the card stays within the window from its current top-left.
  const onResizeDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation()
      resize.current = { x: e.clientX, y: e.clientY, width: size.width, height: size.height }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [size],
  )
  const onResizeMove = useCallback(
    (e: React.PointerEvent) => {
      if (!resize.current) return
      const maxW = window.innerWidth - pos.x - 8
      const maxH = window.innerHeight - pos.y - 8
      const width = Math.max(
        MIN_WIDTH,
        Math.min(maxW, resize.current.width + e.clientX - resize.current.x),
      )
      const height = Math.max(
        MIN_HEIGHT,
        Math.min(maxH, resize.current.height + e.clientY - resize.current.y),
      )
      setSize({ width, height })
    },
    [pos],
  )
  const onResizeUp = useCallback(
    (e: React.PointerEvent) => {
      if (!resize.current) return
      resize.current = null
      e.currentTarget.releasePointerCapture(e.pointerId)
      persistGeometry()
    },
    [persistGeometry],
  )

  return (
    <div
      data-testid="activity-panel"
      className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] shadow-2xl"
      style={{ left: pos.x, top: pos.y, width: size.width, height: size.height }}
    >
      <header
        data-testid="activity-panel-handle"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="flex shrink-0 cursor-grab items-center gap-2 border-b border-[var(--color-line)] px-3 py-2 active:cursor-grabbing"
      >
        <Radio className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden="true" />
        <span className="flex-1 select-none text-xs font-medium text-fg">
          {tr('activity.title')}
        </span>
        <button
          type="button"
          data-testid="activity-clear"
          aria-label={tr('activity.clear')}
          onClick={onClear}
          className="press flex h-6 w-6 items-center justify-center rounded-md text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="activity-close"
          aria-label={tr('common.close')}
          onClick={onClose}
          className="press flex h-6 w-6 items-center justify-center rounded-md text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </header>
      {rows.length === 0 ? (
        <p className="flex-1 px-3 py-6 text-center text-xs text-fg-muted">{tr('activity.empty')}</p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-auto">
          {rows.map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </ul>
      )}
      {/* Corner grip: drags both width and height at once. Its own pointer capture is
          kept separate from the header's so resizing never moves the card. */}
      <div
        data-testid="activity-resize"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
        style={{
          background:
            'linear-gradient(135deg, transparent 50%, var(--color-line-strong) 50%, var(--color-line-strong) 60%, transparent 60%, transparent 75%, var(--color-line-strong) 75%, var(--color-line-strong) 85%, transparent 85%)',
        }}
      />
    </div>
  )
}
