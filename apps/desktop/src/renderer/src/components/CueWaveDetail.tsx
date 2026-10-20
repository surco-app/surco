import { Minus, Plus } from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MEMORY_CUE_COLOR } from '../../../shared/rekordboxCueColors'
import { type DetailSource, visibleColumns } from '../lib/cueDetail'
import { markStyle, placeCues } from '../lib/cueMarks'
import { barsToNextCall, detailWindow, ZOOM_BARS } from '../lib/cuePlayhead'
import { barLines } from '../lib/cueWave'
import type { WaveCue } from './CueWave'

const HEIGHT = 160
const ZOOM_BUTTON =
  'press flex h-6 w-6 items-center justify-center rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel)] text-fg-dim hover:text-fg disabled:opacity-40'

export function CueWaveDetail({
  source,
  grid,
  cues,
  selected,
  playheadMs,
  bars,
  onScrub,
  onZoom,
}: {
  source: DetailSource | null
  grid: { ms: number; beat: number }[]
  cues: WaveCue[]
  selected: string | null
  playheadMs: number
  bars: number
  onScrub: (ms: number) => void
  onZoom: (dir: 'in' | 'out') => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const beats = useMemo(() => grid.map((b) => b.ms), [grid])
  const lines = useMemo(() => barLines(grid), [grid])
  const { fromMs, toMs } = detailWindow(beats, playheadMs, bars)
  const span = toMs - fromMs
  const latest = useRef({ span, onScrub })
  latest.current = { span, onScrub }
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
    const canvas = canvasRef.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g) return
    const width = Math.max(1, Math.round(canvas.getBoundingClientRect().width))
    canvas.width = width
    canvas.height = HEIGHT
    g.clearRect(0, 0, width, HEIGHT)
    if (!source) return
    const faint = getComputedStyle(canvas).getPropertyValue('--color-fg-faint')
    visibleColumns(source, fromMs, toMs, width).forEach((column, x) => {
      if (!column) return
      const h = Math.max(column.h * HEIGHT, 1)
      g.fillStyle = column.rgb ? `rgb(${column.rgb.join(',')})` : faint
      g.fillRect(x, (HEIGHT - h) / 2, 1, h)
    })
  }, [source, fromMs, toMs])
  const { hot, calls } = placeCues(
    cues.map((c) => ({ ...c, ms: c.ms - fromMs })),
    span,
  )
  const pendingOf = new Map(cues.map((c) => [c.key, c.pending]))
  const toCall = barsToNextCall(beats, cues, playheadMs)
  const zoomAt = ZOOM_BARS.findIndex((z) => z === bars)
  const pct = (ms: number): string => `${((ms - fromMs) / span) * 100}%`
  return (
    <div
      ref={rootRef}
      data-testid="cue-detail"
      role="img"
      aria-label={t('editor.cues.detail')}
      onMouseDown={(e) => {
        if (e.button !== 0) return
        const width = rootRef.current?.getBoundingClientRect().width ?? 0
        if (width > 0) setDrag({ x0: e.clientX, ms0: playheadMs, width })
      }}
      className="relative h-40 w-full cursor-grab select-none overflow-hidden rounded-md bg-[var(--color-panel-2)]"
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {lines
        .filter((b) => b.ms >= fromMs && b.ms <= toMs)
        .map((b) => (
          <span
            key={b.ms}
            data-testid="cue-detail-bar"
            aria-hidden="true"
            style={{ left: pct(b.ms) }}
            className={`absolute top-0 bottom-0 w-px ${
              b.strong ? 'bg-[var(--color-fg)]/40' : 'bg-[var(--color-fg)]/15'
            }`}
          />
        ))}
      {calls.map((c) => (
        <span
          key={`c${c.key}`}
          data-testid={`cue-detail-call-${c.ms + fromMs}`}
          aria-hidden="true"
          style={{ ...markStyle(c.at, 'call', 'wave'), borderTopColor: MEMORY_CUE_COLOR }}
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
            data-selected={selected === h.key ? 'true' : 'false'}
            aria-hidden="true"
            style={{
              ...markStyle(h.at, 'hot', 'wave'),
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
        style={{ backgroundColor: MEMORY_CUE_COLOR }}
        className="pointer-events-none absolute top-0 bottom-0 left-1/2 w-0.5 -translate-x-1/2"
      />
      {toCall !== null && (
        <span
          data-testid="cue-detail-to-call"
          style={{ color: MEMORY_CUE_COLOR }}
          className="pointer-events-none absolute top-6 right-1/2 mr-2 whitespace-nowrap font-mono text-[13px] font-semibold tabular-nums"
        >
          {t('editor.cues.toCall', { bars: `-${toCall.toFixed(1)}` })}
        </span>
      )}
      <div className="absolute top-1/2 left-2 flex -translate-y-1/2 flex-col gap-1.5">
        <button
          type="button"
          data-testid="cue-detail-zoom-in"
          aria-label={t('editor.cues.zoomIn')}
          disabled={zoomAt === 0}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => onZoom('in')}
          className={ZOOM_BUTTON}
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="cue-detail-zoom-out"
          aria-label={t('editor.cues.zoomOut')}
          disabled={zoomAt === ZOOM_BARS.length - 1}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => onZoom('out')}
          className={ZOOM_BUTTON}
        >
          <Minus className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
