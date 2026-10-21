import { Minus, Plus, Search } from 'lucide-react'
import type React from 'react'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CueQuantize } from '../../../shared/cueQuantize'
import { nearestBeat } from '../../../shared/cueRules'
import { MEMORY_CUE_COLOR } from '../../../shared/rekordboxCueColors'
import { type DetailSource, paintWave, waveColumns } from '../lib/cueDetail'
import {
  type CueGhost,
  droppedStyle,
  GHOST_OPACITY,
  GONE_OPACITY,
  markStyle,
  placeCues,
  visibleGhost,
  WAVE_MARK_LANE_PX,
} from '../lib/cueMarks'
import {
  barsToNextCall,
  cueClock,
  DEFAULT_ZOOM_BARS,
  detailWindow,
  snapToBeat,
  wheelZoom,
  wholeBars,
  zoomStep,
} from '../lib/cuePlayhead'
import { barLines, quantizePoints } from '../lib/cueWave'
import { CueDeleteBadge } from './CueDeleteBadge'
import type { WaveCue } from './CueWave'

const STAGE_HEIGHT = 'clamp(160px, 24vh, 240px)'
const COMPACT_HEIGHT = '96px'
const WAVE_SPAN = 0.8
const STRIP_WINDOWS = 3
const DRAG_PX = 3
const BAR_LINE_OPACITY = 0.5
const ZOOM_BUTTON =
  'press flex h-6 w-6 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-[var(--color-line-strong)] hover:text-fg disabled:pointer-events-none disabled:opacity-40'

export function CueZoom({
  bars,
  onZoom,
  onReset,
  row,
}: {
  bars: number
  onZoom: (dir: 'in' | 'out') => void
  onReset?: () => void
  row?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const buttons = [
    ['cue-zoom-in', 'editor.cues.zoomIn', Plus, () => onZoom('in'), zoomStep(bars, 'in') === bars],
    [
      'cue-zoom-reset',
      'editor.cues.zoomReset',
      Search,
      () => onReset?.(),
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
  return (
    <div
      data-testid="cue-zoom"
      className={
        row
          ? 'flex shrink-0 items-center gap-0.5'
          : 'absolute top-0 right-full mr-1 flex flex-col gap-1'
      }
    >
      {(row ? [buttons[2], buttons[1], buttons[0]] : buttons).map(([id, label, Icon, act, off]) => (
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
  )
}

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
  compact,
  onPlace,
  onHover,
  onMarkMenu,
  onDeleteMark,
  ghost: rawGhost,
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
  compact?: boolean
  onPlace?: (ms: number) => void
  onHover?: (ms: number | null) => void
  onMarkMenu?: (at: { key: string; clientX: number; clientY: number }) => void
  onDeleteMark?: (key: string) => void
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
  const lines = useMemo(() => barLines(grid).map((b) => b.ms), [grid])
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
      if (!moved.current && Math.abs(e.clientX - drag.x0) <= DRAG_PX) return
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
  const strip = useRef<{
    data: unknown
    fromMs: number
    toMs: number
    span: number
    width: number
    height: number
    dpr: number
  } | null>(null)
  const sync = (force: boolean) => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    const g = canvas?.getContext('2d')
    if (!canvas || !stage || !g) return
    const width = Math.max(1, Math.round(stage.getBoundingClientRect().width))
    const height = Math.max(1, Math.round(canvas.getBoundingClientRect().height))
    const dpr = window.devicePixelRatio || 1
    const data = source && ('words' in source ? source.words : source.wave)
    const was = strip.current
    if (
      force ||
      !was ||
      was.data !== data ||
      was.width !== width ||
      was.height !== height ||
      was.dpr !== dpr ||
      Math.abs(was.span - span) > span * 0.05 ||
      fromMs < was.fromMs ||
      toMs > was.toMs
    ) {
      const columns = Math.round(width * STRIP_WINDOWS * dpr)
      if (canvas.width !== columns) canvas.width = columns
      if (canvas.height !== height * dpr) canvas.height = height * dpr
      g.setTransform(1, 0, 0, 1, 0, 0)
      g.clearRect(0, 0, canvas.width, canvas.height)
      const reach = ((STRIP_WINDOWS - 1) / 2) * span
      strip.current = {
        data,
        fromMs: fromMs - reach,
        toMs: toMs + reach,
        span,
        width,
        height,
        dpr,
      }
      if (source) {
        const style = getComputedStyle(canvas)
        paintWave(
          g,
          waveColumns(source, fromMs - reach, toMs + reach, columns),
          canvas.height,
          {
            peak: style.getPropertyValue('--color-fg-faint').trim(),
            body: style.getPropertyValue('--color-accent').trim(),
          },
          WAVE_SPAN,
        )
      }
    }
    const drawn = strip.current as NonNullable<typeof strip.current>
    canvas.style.left = `${((drawn.fromMs - fromMs) / span) * 100}%`
    canvas.style.width = `${((drawn.toMs - drawn.fromMs) / span) * 100}%`
  }
  const syncLatest = useRef(sync)
  syncLatest.current = sync
  useLayoutEffect(() => syncLatest.current(false))
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => syncLatest.current(true))
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])
  const { hot, calls } = placeCues(
    cues.map((c) => ({ ...c, ms: c.ms - fromMs })),
    span,
  )
  const pendingOf = new Map(cues.map((c) => [c.key, c.pending]))
  const ghost = visibleGhost(rawGhost, cues)
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
      {!compact && (
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
              {t('editor.cues.toCall', { count: wholeBars(toCall) })}
            </span>
          )}
        </div>
      )}
      <div className="relative">
        {!compact && <CueZoom bars={bars} onZoom={onZoom} onReset={onZoomReset} />}
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
            onHover?.(snapAt(e.clientX, rect))
          }}
          onMouseLeave={() => onHover?.(null)}
          style={{
            cursor: onPlace ? 'crosshair' : 'grab',
            height: compact ? COMPACT_HEIGHT : STAGE_HEIGHT,
          }}
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
            .filter((ms) => ms >= fromMs && ms <= toMs)
            .map((ms) => (
              <span
                key={ms}
                data-testid="cue-detail-bar"
                data-ms={ms}
                aria-hidden="true"
                style={{
                  left: pct(ms),
                  top: `${WAVE_MARK_LANE_PX}px`,
                  width: '2px',
                  transform: 'translateX(-50%)',
                  backgroundColor: MEMORY_CUE_COLOR,
                  opacity: BAR_LINE_OPACITY,
                }}
                className="absolute bottom-0"
              />
            ))}
          <canvas
            ref={canvasRef}
            style={{
              top: `${WAVE_MARK_LANE_PX}px`,
              height: `calc(100% - ${WAVE_MARK_LANE_PX}px)`,
            }}
            className="absolute"
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
                className="absolute z-10 h-0 w-0 border-x-[5px] border-x-transparent border-t-[7px]"
              />
              {badge(c.key, c.at, t('editor.cues.deleteCallMark'), 9)}
            </Fragment>
          ))}
          {hot.map((h) => {
            return (
              <Fragment key={`h${h.key}`}>
                <span
                  role="img"
                  data-testid={`cue-detail-hot-${h.letter}`}
                  data-mark="true"
                  data-gone={gone.has(h.key) ? 'true' : 'false'}
                  data-pending={pendingOf.get(h.key) ? 'true' : 'false'}
                  data-selected={selected === h.key ? 'true' : 'false'}
                  aria-hidden="true"
                  onContextMenu={(e) => markMenu(h.key, e)}
                  {...hover(h.key)}
                  {...grab(h.key)}
                  style={{
                    ...markStyle(h.at),
                    backgroundColor: h.colour,
                    color: '#000',
                    ...(gone.has(h.key) ? { opacity: GONE_OPACITY } : {}),
                    ...(movable?.includes(h.key) && onMoveMark ? { cursor: 'ew-resize' } : {}),
                  }}
                  className={`absolute z-10 h-3.5 w-3.5 rounded-[3px] text-center text-[9px] font-bold leading-[14px] ${
                    selected === h.key ? 'ring-2 ring-[var(--color-fg)]' : ''
                  }`}
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
        </div>
      </div>
    </div>
  )
}
