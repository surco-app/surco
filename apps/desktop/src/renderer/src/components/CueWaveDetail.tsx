import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MEMORY_CUE_COLOR } from '../../../shared/rekordboxCueColors'
import { type DetailSource, visibleColumns } from '../lib/cueDetail'
import { markStyle, placeCues, WAVE_MARK_LANE_PX } from '../lib/cueMarks'
import { barsToNextCall, cueClock, detailWindow, wheelZoom } from '../lib/cuePlayhead'
import { barLines } from '../lib/cueWave'
import type { WaveCue } from './CueWave'

const STAGE_HEIGHT = 'clamp(160px, 24vh, 240px)'
const WAVE_SPAN = 0.8
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
  onScrub,
  onZoom,
  onPick,
}: {
  source: DetailSource | null
  grid: { ms: number; beat: number }[]
  cues: WaveCue[]
  selected: string | null
  playheadMs: number
  bars: number
  onScrub: (ms: number) => void
  onZoom: (dir: 'in' | 'out') => void
  onPick?: (ms: number) => void
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
  const latest = useRef({ span, onScrub, onZoom })
  latest.current = { span, onScrub, onZoom }
  const [drag, setDrag] = useState<{ x0: number; ms0: number; width: number } | null>(null)
  useEffect(() => {
    if (!drag) return
    const move = (e: MouseEvent) =>
      latest.current.onScrub(drag.ms0 - ((e.clientX - drag.x0) / drag.width) * latest.current.span)
    const up = () => setDrag(null)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [drag])
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
  const toCall = barsToNextCall(beats, cues, playheadMs)
  const pct = (ms: number): string => `${((ms - fromMs) / span) * 100}%`
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
      <div
        ref={stageRef}
        data-testid="cue-detail"
        role="img"
        aria-label={t('editor.cues.detail')}
        onMouseDown={(e) => {
          if (e.button !== 0) return
          const rect = stageRef.current?.getBoundingClientRect()
          if (!rect || rect.width <= 0) return
          if (onPick) onPick(fromMs + ((e.clientX - rect.left) / rect.width) * span)
          else setDrag({ x0: e.clientX, ms0: playheadMs, width: rect.width })
        }}
        style={{ cursor: onPick ? 'crosshair' : 'grab', height: STAGE_HEIGHT }}
        className="relative w-full shrink-0 select-none overflow-hidden"
      >
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
        {calls.map((c) => (
          <span
            key={`c${c.key}`}
            data-testid={`cue-detail-call-${c.ms + fromMs}`}
            data-pending={pendingOf.get(c.key) ? 'true' : 'false'}
            aria-hidden="true"
            style={{ ...markStyle(c.at), borderTopColor: MEMORY_CUE_COLOR }}
            className={`absolute h-0 w-0 border-x-[5px] border-x-transparent border-t-[7px] ${
              pendingOf.get(c.key) ? 'opacity-60' : ''
            }`}
          />
        ))}
        {hot.map((h) => {
          const pending = pendingOf.get(h.key) ?? false
          return (
            <span
              key={`h${h.key}`}
              data-testid={`cue-detail-hot-${h.letter}`}
              data-pending={pending ? 'true' : 'false'}
              data-selected={selected === h.key ? 'true' : 'false'}
              aria-hidden="true"
              style={{
                ...markStyle(h.at),
                ...(pending
                  ? { borderColor: h.colour, color: h.colour }
                  : { backgroundColor: h.colour, color: '#000' }),
              }}
              className={`absolute h-3.5 w-3.5 rounded-[3px] text-center text-[9px] font-bold leading-[14px] ${
                pending ? 'border' : ''
              } ${selected === h.key ? 'ring-2 ring-[var(--color-fg)]' : ''}`}
            >
              {h.letter}
            </span>
          )
        })}
        <span
          data-testid="cue-detail-playhead"
          aria-hidden="true"
          className="pointer-events-none absolute top-0 bottom-0 left-1/2 w-px bg-[var(--color-fg)]"
        />
      </div>
    </div>
  )
}
