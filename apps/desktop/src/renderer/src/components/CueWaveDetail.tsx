import { Minus, Plus, RotateCcw } from 'lucide-react'
import type React from 'react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CueQuantize } from '../../../shared/cueQuantize'
import { nearestBeat } from '../../../shared/cueRules'
import { MEMORY_CUE_COLOR } from '../../../shared/rekordboxCueColors'
import { type DetailSource, visibleColumns } from '../lib/cueDetail'
import {
  CURSOR_LINE,
  type CueGhost,
  droppedStyle,
  GHOST_OPACITY,
  GONE_OPACITY,
  markStyle,
  placeCues,
  WAVE_MARK_LANE_PX,
} from '../lib/cueMarks'
import {
  barsToNextCall,
  cueClock,
  DEFAULT_ZOOM_BARS,
  detailWindow,
  snapToBeat,
  wheelZoom,
  zoomStep,
} from '../lib/cuePlayhead'
import { barLines, quantizePoints } from '../lib/cueWave'
import { CueDeleteBadge } from './CueDeleteBadge'
import type { WaveCue } from './CueWave'

const STAGE_HEIGHT = 'clamp(160px, 24vh, 240px)'
const WAVE_SPAN = 0.8
const DRAG_PX = 3
const ZOOM_BUTTON =
  'press flex h-6 w-6 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-[var(--color-line-strong)] hover:text-fg disabled:pointer-events-none disabled:opacity-40'
const CAPS = [
  {
    position: 'top-0',
    colour: 'borderTopColor',
    grey: 'border-t-[var(--color-fg-dim)]',
    shape: 'border-t-[3px]',
  },
  {
    position: 'bottom-0',
    colour: 'borderBottomColor',
    grey: 'border-b-[var(--color-fg-dim)]',
    shape: 'border-b-[3px]',
  },
] as const

export function CueWaveDetail({
  source,
  grid,
  cues,
  selected,
  playheadMs,
  bars,
  quantize,
  onScrub,
  onZoom,
  onZoomReset,
  onPlace,
  onMarkMenu,
  onDeleteMark,
  onHover,
  ghost,
  points,
  movable,
  onMoveMark,
  onMarkDrag,
}: {
  source: DetailSource | null
  grid: { ms: number; beat: number }[]
  cues: WaveCue[]
  selected: string | null
  playheadMs: number
  bars: number
  quantize: CueQuantize
  onScrub: (ms: number) => void
  onZoom: (dir: 'in' | 'out') => void
  onZoomReset?: () => void
  onPlace?: (ms: number) => void
  onMarkMenu?: (at: { key: string; clientX: number; clientY: number }) => void
  onDeleteMark?: (key: string) => void
  onHover?: (ms: number | null) => void
  ghost?: CueGhost
  points: number[]
  movable?: string[]
  onMoveMark?: (key: string, ms: number) => void
  onMarkDrag?: (dragging: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const beats = useMemo(() => grid.map((b) => b.ms), [grid])
  const lines = useMemo(
    () => barLines(grid).map((b, i) => ({ ms: b.ms, bar: i + 1, phrase: i % 4 === 0 })),
    [grid],
  )
  const { fromMs, toMs } = detailWindow(beats, playheadMs, bars)
  const span = toMs - fromMs
  const snapMs = useMemo(() => quantizePoints(grid, quantize), [grid, quantize])
  const latest = useRef({ span, beats, onScrub, onZoom, onPlace })
  latest.current = { span, beats, onScrub, onZoom, onPlace }
  const [drag, setDrag] = useState<{
    x0: number
    ms0: number
    width: number
    pick: number | null
  } | null>(null)
  const moved = useRef(false)
  useEffect(() => {
    if (!drag) return
    moved.current = false
    let scrubbed: number | null = null
    const move = (e: MouseEvent) => {
      if (!moved.current && drag.pick !== null && Math.abs(e.clientX - drag.x0) <= DRAG_PX) return
      moved.current = true
      const ms = snapToBeat(
        latest.current.beats,
        drag.ms0 - ((e.clientX - drag.x0) / drag.width) * latest.current.span,
      )
      if (ms === scrubbed) return
      scrubbed = ms
      latest.current.onScrub(ms)
    }
    const up = () => {
      if (!moved.current && drag.pick !== null) latest.current.onPlace?.(drag.pick)
      setDrag(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [drag])
  const [markDrag, setMarkDrag] = useState<{
    key: string
    x0: number
    left: number
    width: number
    fromMs: number
    span: number
    snapMs: number[]
  } | null>(null)
  const [dragAt, setDragAt] = useState<number | null>(null)
  const markLatest = useRef({ onMoveMark, onMarkDrag })
  markLatest.current = { onMoveMark, onMarkDrag }
  const markDragging = markDrag !== null
  useEffect(() => {
    markLatest.current.onMarkDrag?.(markDragging)
  }, [markDragging])
  useEffect(() => {
    if (!markDrag) return
    let ms: number | null = null
    const move = (e: MouseEvent) => {
      if (ms === null && Math.abs(e.clientX - markDrag.x0) <= DRAG_PX) return
      const at =
        markDrag.fromMs +
        ((e.clientX - markDrag.left) / Math.max(markDrag.width, 1)) * markDrag.span
      ms = markDrag.snapMs[nearestBeat(markDrag.snapMs, at)]
      setDragAt(((ms - markDrag.fromMs) / markDrag.span) * 100)
    }
    const up = () => {
      if (ms !== null) markLatest.current.onMoveMark?.(markDrag.key, ms)
      setDragAt(null)
      setMarkDrag(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [markDrag])
  const grab = (key: string) =>
    onMoveMark && movable?.includes(key)
      ? {
          onMouseDown: (e: React.MouseEvent) => {
            if (e.button !== 0) return
            const rect = stageRef.current?.getBoundingClientRect()
            if (!rect || rect.width <= 0) return
            e.stopPropagation()
            setCursor(null)
            onHover?.(null)
            setMarkDrag({
              key,
              x0: e.clientX,
              left: rect.left,
              width: rect.width,
              fromMs,
              span,
              snapMs,
            })
          },
        }
      : {}
  const [cursor, setCursor] = useState<number | null>(null)
  const canPlace = onPlace !== undefined
  useEffect(() => {
    if (!canPlace) setCursor(null)
  }, [canPlace])
  const snapAt = (clientX: number, rect: DOMRect): number =>
    snapMs[nearestBeat(snapMs, fromMs + ((clientX - rect.left) / rect.width) * span)]
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    let pending = 0
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const step = wheelZoom(pending, e.deltaY)
      pending = step.pending
      if (step.dir) latest.current.onZoom(step.dir)
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [])
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g) return
    const rect = canvas.getBoundingClientRect()
    const width = Math.max(1, Math.round(rect.width))
    const height = Math.max(1, Math.round(rect.height))
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, width, height)
    if (!source) return
    const accent = getComputedStyle(canvas).getPropertyValue('--color-accent').trim()
    g.globalAlpha = 0.7
    visibleColumns(source, fromMs, toMs, width).forEach((column, x) => {
      if (!column) return
      const h = Math.max(column.h * height * WAVE_SPAN, 1)
      g.fillStyle = accent
      g.fillRect(x, (height - h) / 2, 1, h)
    })
  }, [source, fromMs, toMs])
  useEffect(draw, [draw])
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(draw)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [draw])
  const { hot, calls } = placeCues(
    cues.map((c) => ({ ...c, ms: c.ms - fromMs })),
    span,
  )
  const pendingOf = new Map(cues.map((c) => [c.key, c.pending]))
  const toCall = barsToNextCall(beats, points, playheadMs)
  const pct = (ms: number): string => `${((ms - fromMs) / span) * 100}%`
  const gone = new Set(ghost?.gone ?? [])
  const ghostMarks = ghost
    ? placeCues(
        ghost.added.map((c) => ({ ...c, ms: c.ms - fromMs })),
        span,
      )
    : null
  const [hovered, setHovered] = useState<string | null>(null)
  const lockedKeys = new Set(cues.filter((c) => c.locked).map((c) => c.key))
  const hover = (key: string) => ({
    onMouseEnter: () => setHovered(key),
    onMouseLeave: () => setHovered(null),
  })
  const badge = (key: string, at: number, label: string, offsetPx: number) =>
    hovered === key &&
    !lockedKeys.has(key) &&
    onDeleteMark && (
      <CueDeleteBadge
        key={`x${key}`}
        testId="cue-detail-delete"
        label={label}
        onDelete={() => {
          setHovered(null)
          onDeleteMark(key)
        }}
        className="top-0"
        style={{ ...markStyle(at), transform: `translateX(calc(-50% + ${offsetPx}px))` }}
        {...hover(key)}
      />
    )
  const markMenu = (key: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onMarkMenu?.({ key, clientX: e.clientX, clientY: e.clientY })
  }
  return (
    <div className="flex shrink-0 flex-col">
      <div className="relative h-4 shrink-0 text-xs tabular-nums">
        <span
          data-testid="cues-position"
          className="absolute right-1/2 mr-2 font-semibold whitespace-nowrap text-fg"
        >
          {cueClock(playheadMs)}
        </span>
        {toCall !== null && (
          <span
            data-testid="cue-detail-to-call"
            className="absolute left-1/2 ml-2 whitespace-nowrap text-fg-dim"
          >
            {t('editor.cues.toCall', { count: Number(toCall.toFixed(1)) })}
          </span>
        )}
      </div>
      <div className="relative">
        <div data-testid="cue-zoom" className="absolute top-0 right-full mr-1 flex flex-col gap-1">
          {(
            [
              [
                'cue-zoom-in',
                'editor.cues.zoomIn',
                Plus,
                () => onZoom('in'),
                zoomStep(bars, 'in') === bars,
              ],
              [
                'cue-zoom-reset',
                'editor.cues.zoomReset',
                RotateCcw,
                () => onZoomReset?.(),
                bars === DEFAULT_ZOOM_BARS,
              ],
              [
                'cue-zoom-out',
                'editor.cues.zoomOut',
                Minus,
                () => onZoom('out'),
                zoomStep(bars, 'out') === bars,
              ],
            ] as const
          ).map(([id, label, Icon, act, off]) => (
            <button
              key={id}
              type="button"
              data-testid={id}
              aria-label={t(label)}
              title={t(label)}
              disabled={off}
              onClick={act}
              className={ZOOM_BUTTON}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ))}
        </div>
        <div
          ref={stageRef}
          data-testid="cue-detail"
          role="img"
          aria-label={t('editor.cues.detail')}
          onMouseDown={(e) => {
            if (e.button !== 0) return
            const rect = stageRef.current?.getBoundingClientRect()
            if (!rect || rect.width <= 0) return
            const onMark = (e.target as HTMLElement).closest('[data-mark]') !== null
            setCursor(null)
            onHover?.(null)
            setDrag({
              x0: e.clientX,
              ms0: playheadMs,
              width: rect.width,
              pick: onPlace && !onMark ? snapAt(e.clientX, rect) : null,
            })
          }}
          onMouseMove={(e) => {
            if (!onPlace || drag || markDrag) return
            const rect = stageRef.current?.getBoundingClientRect()
            if (!rect || rect.width <= 0) return
            const ms = snapAt(e.clientX, rect)
            setCursor(ms)
            onHover?.(ms)
          }}
          onMouseLeave={() => {
            setCursor(null)
            onHover?.(null)
          }}
          style={{ cursor: onPlace ? 'crosshair' : 'grab', height: STAGE_HEIGHT }}
          className="relative w-full shrink-0 select-none overflow-hidden"
        >
          {quantize === 'beat' &&
            grid
              .filter((b) => b.beat !== 1 && b.ms >= fromMs && b.ms <= toMs)
              .map((b) => (
                <span
                  key={b.ms}
                  data-testid="cue-detail-beat"
                  aria-hidden="true"
                  style={{ left: pct(b.ms), top: `${WAVE_MARK_LANE_PX}px` }}
                  className="absolute bottom-0 w-px bg-[var(--color-fg-dim)]/15"
                />
              ))}
          {lines
            .filter((b) => b.ms >= fromMs && b.ms <= toMs)
            .map((b) => (
              <span
                key={b.ms}
                data-testid="cue-detail-bar"
                data-bar={b.bar}
                data-phrase={b.phrase ? 'true' : 'false'}
                aria-hidden="true"
                style={{ left: pct(b.ms), top: `${WAVE_MARK_LANE_PX}px` }}
                className="absolute bottom-0 w-px bg-[var(--color-fg-dim)]/35"
              >
                {CAPS.map((cap) => (
                  <span
                    key={cap.position}
                    data-testid="cue-detail-cap"
                    style={b.phrase ? { [cap.colour]: MEMORY_CUE_COLOR } : undefined}
                    className={`absolute left-1/2 h-0 w-0 -translate-x-1/2 border-x-[2.5px] border-x-transparent ${cap.position} ${
                      b.phrase ? '' : cap.grey
                    } ${cap.shape}`}
                  />
                ))}
              </span>
            ))}
          <canvas
            ref={canvasRef}
            style={{
              top: `${WAVE_MARK_LANE_PX}px`,
              height: `calc(100% - ${WAVE_MARK_LANE_PX}px)`,
            }}
            className="absolute inset-x-0 w-full"
          />
          <span
            data-testid="cue-detail-playhead"
            aria-hidden="true"
            style={{ top: `${WAVE_MARK_LANE_PX}px` }}
            className="pointer-events-none absolute bottom-0 left-1/2 w-px bg-[var(--color-fg)]"
          />
          {calls.map((c) => (
            <Fragment key={`c${c.key}`}>
              <span
                role="img"
                data-testid={`cue-detail-call-${c.ms + fromMs}`}
                data-mark="true"
                data-gone={gone.has(c.key) ? 'true' : 'false'}
                data-pending={pendingOf.get(c.key) ? 'true' : 'false'}
                aria-hidden="true"
                onContextMenu={(e) => markMenu(c.key, e)}
                {...hover(c.key)}
                {...grab(c.key)}
                style={{
                  ...markStyle(c.at),
                  borderTopColor: MEMORY_CUE_COLOR,
                  ...(movable?.includes(c.key) && onMoveMark ? { cursor: 'ew-resize' } : {}),
                  ...(gone.has(c.key) ? { opacity: GONE_OPACITY } : {}),
                }}
                className={`absolute z-10 h-0 w-0 border-x-[5px] border-x-transparent border-t-[7px] ${
                  pendingOf.get(c.key) ? 'opacity-60' : ''
                }`}
              />
              {badge(c.key, c.at, t('editor.cues.deleteCallMark'), 9)}
            </Fragment>
          ))}
          {hot.map((h) => {
            const pending = pendingOf.get(h.key) ?? false
            return (
              <Fragment key={`h${h.key}`}>
                <span
                  role="img"
                  data-testid={`cue-detail-hot-${h.letter}`}
                  data-mark="true"
                  data-gone={gone.has(h.key) ? 'true' : 'false'}
                  data-pending={pending ? 'true' : 'false'}
                  data-selected={selected === h.key ? 'true' : 'false'}
                  aria-hidden="true"
                  onContextMenu={(e) => markMenu(h.key, e)}
                  {...hover(h.key)}
                  style={{
                    ...markStyle(h.at),
                    ...(pending
                      ? { borderColor: h.colour, color: h.colour }
                      : { backgroundColor: h.colour, color: '#000' }),
                    ...(gone.has(h.key) ? { opacity: GONE_OPACITY } : {}),
                  }}
                  className={`absolute z-10 h-3.5 w-3.5 rounded-[3px] text-center text-[9px] font-bold leading-[14px] ${
                    pending ? 'border' : ''
                  } ${selected === h.key ? 'ring-2 ring-[var(--color-fg)]' : ''}`}
                >
                  {h.letter}
                </span>
                {badge(h.key, h.at, t('editor.cues.deleteHot', { letter: h.letter }), 11)}
              </Fragment>
            )
          })}
          {ghostMarks?.calls.map((c) => (
            <span
              key={`gc${c.key}`}
              data-testid={`cue-detail-ghost-call-${c.ms + fromMs}`}
              aria-hidden="true"
              style={{
                ...markStyle(c.at),
                borderTopColor: MEMORY_CUE_COLOR,
                opacity: GHOST_OPACITY,
              }}
              className="pointer-events-none absolute z-10 h-0 w-0 border-x-[5px] border-x-transparent border-t-[7px]"
            />
          ))}
          {ghostMarks?.hot.map((h) => (
            <span
              key={`gh${h.key}`}
              data-testid={`cue-detail-ghost-hot-${h.letter}`}
              aria-hidden="true"
              style={{
                ...markStyle(h.at),
                backgroundColor: h.colour,
                color: '#000',
                opacity: GHOST_OPACITY,
              }}
              className="pointer-events-none absolute z-10 h-3.5 w-3.5 rounded-[3px] text-center text-[9px] font-bold leading-[14px]"
            >
              {h.letter}
            </span>
          ))}
          {(ghost?.rejected ?? [])
            .filter(
              (r, i, all) =>
                r.ms >= fromMs && r.ms <= toMs && all.findIndex((o) => o.ms === r.ms) === i,
            )
            .map((r) => (
              <span
                key={`gd${r.ms}`}
                data-testid={`cue-detail-ghost-dropped-${r.ms}`}
                aria-hidden="true"
                style={droppedStyle(((r.ms - fromMs) / span) * 100, r)}
                className="pointer-events-none absolute z-10 h-3.5 w-3.5 rounded-[3px] border"
              />
            ))}
          {dragAt !== null && (
            <span
              data-testid="cue-detail-drag-ghost"
              aria-hidden="true"
              style={{ left: `${dragAt}%` }}
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-[var(--color-fg)]/70"
            />
          )}
          {cursor !== null && cursor >= fromMs && cursor <= toMs && (
            <span
              data-testid="cue-detail-cursor"
              aria-hidden="true"
              style={{ ...CURSOR_LINE, left: pct(cursor) }}
              className="pointer-events-none absolute top-0 bottom-0"
            />
          )}
        </div>
      </div>
    </div>
  )
}
