import type React from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CueQuantize } from '../../../shared/cueQuantize'
import { nearestBeat } from '../../../shared/cueRules'
import type { DropProposal } from '../../../shared/dropDetect'
import { MEMORY_CUE_COLOR } from '../../../shared/rekordboxCueColors'
import type { CueWaveColumn } from '../../../shared/types'
import { useThemeRgb } from '../hooks/useThemeRgb'
import { paintWave, waveColumns } from '../lib/cueDetail'
import {
  type CueGhost,
  droppedStyle,
  GHOST_OPACITY,
  GONE_OPACITY,
  HOT_MARK_PX,
  markStyle,
  placeCues,
  visibleGhost,
} from '../lib/cueMarks'
import { snapToBeat } from '../lib/cuePlayhead'
import { barLines, peakBars, quantizePoints } from '../lib/cueWave'
import { formatTime } from '../lib/duration'
import { CueDeleteBadge } from './CueDeleteBadge'
import { WaveBars } from './WaveBars'

export interface WaveCue {
  key: string
  ms: number
  kind: number
  color: number | null
  pending: boolean
  locked?: boolean
}

const PHRASE_BARS = 8
const PHRASES_PER_STRONG_TICK = 4
const OVERVIEW_BARS = 300
const ROW_BAR_PITCH_PX = 3
const WAVE_HEIGHT = '90%'
const SLIM_WAVE_HEIGHT = `calc(100% - ${HOT_MARK_PX.row + 2}px)`

export function CueWave({
  wave,
  grid,
  quantize = 'beat',
  durationMs,
  cues,
  selected,
  proposals,
  onDropProposal,
  trimmed,
  readOnly,
  offGrid,
  anchors,
  onSelect,
  onMenu,
  onMarkMenu,
  playheadMs,
  onSeek,
  slim,
  view,
  ghost: rawGhost,
  cursorMs,
  detail,
}: {
  wave: CueWaveColumn[] | null
  grid: { ms: number; beat: number }[]
  quantize?: CueQuantize
  durationMs: number
  cues: WaveCue[]
  selected?: string | null
  proposals?: DropProposal[]
  onDropProposal?: (ms: number) => void
  trimmed?: number[]
  readOnly?: boolean
  offGrid?: string[]
  anchors?: number[]
  onSelect?: (key: string | null) => void
  onMenu?: (at: { ms: number; x: number; y: number }) => void
  onMarkMenu?: (at: { key: string; clientX: number; clientY: number }) => void
  playheadMs?: number
  onSeek?: (ms: number) => void
  slim?: boolean
  view?: { fromMs: number; toMs: number }
  ghost?: CueGhost
  cursorMs?: number
  detail?: Uint16Array | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const [hoverProposal, setHoverProposal] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [seeking, setSeeking] = useState(false)
  const sought = useRef<number | null>(null)
  const [stripPx, setStripPx] = useState(0)
  const analysed = grid.length > 0
  const snapMs = useMemo(() => quantizePoints(grid, quantize), [grid, quantize])
  const latest = useRef({ durationMs, onSeek })
  latest.current = { durationMs, onSeek }
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!analysed || !root) return
    const measure = () => setStripPx(root.getBoundingClientRect().width)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [analysed])
  const overviewBars =
    stripPx > 0 ? Math.max(1, Math.round(stripPx / ROW_BAR_PITCH_PX)) : OVERVIEW_BARS
  const msAtX = useCallback((clientX: number): number => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return 0
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width)
    return (x / Math.max(rect.width, 1)) * latest.current.durationMs
  }, [])
  const beatsMs = useMemo(() => grid.map((b) => b.ms), [grid])
  const seekAt = useCallback(
    (clientX: number): number => snapToBeat(beatsMs, msAtX(clientX)),
    [beatsMs, msAtX],
  )
  useEffect(() => {
    if (!seeking) return
    const move = (e: MouseEvent) => {
      const ms = seekAt(e.clientX)
      if (ms === sought.current) return
      sought.current = ms
      latest.current.onSeek?.(ms)
    }
    const up = () => setSeeking(false)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    window.addEventListener('blur', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('blur', up)
    }
  }, [seeking, seekAt])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const waveHeight = slim ? SLIM_WAVE_HEIGHT : WAVE_HEIGHT
  // The canvas reads its colours as it paints, so a theme switch has to repaint it.
  const accent = useThemeRgb('--color-accent')
  const faint = useThemeRgb('--color-fg-faint')
  // biome-ignore lint/correctness/useExhaustiveDependencies: `accent` and `faint` are the theme trigger; the paint reads the same tokens off the canvas.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g || !detail || stripPx <= 0) return
    canvas.style.height = waveHeight
    const dpr = window.devicePixelRatio || 1
    const columns = Math.round(stripPx * dpr)
    const height = Math.max(1, Math.round(canvas.getBoundingClientRect().height * dpr))
    if (canvas.width !== columns) canvas.width = columns
    if (canvas.height !== height) canvas.height = height
    g.clearRect(0, 0, columns, height)
    const style = getComputedStyle(canvas)
    paintWave(g, waveColumns({ words: detail }, 0, durationMs, columns), height, {
      peak: style.getPropertyValue('--color-fg-faint').trim(),
      body: style.getPropertyValue('--color-accent').trim(),
    })
  }, [detail, stripPx, durationMs, waveHeight, accent, faint])
  const waveSvg = useMemo(
    () =>
      detail ? (
        <canvas
          ref={canvasRef}
          data-testid="cue-wave-canvas"
          className="absolute inset-x-0 bottom-0 w-full"
        />
      ) : (
        wave && (
          <WaveBars
            bars={peakBars(
              wave.map((c) => c.h),
              overviewBars,
            )}
            testId="cue-wave-bars"
            className="absolute inset-x-0 bottom-0 w-full"
            style={{ height: slim ? SLIM_WAVE_HEIGHT : WAVE_HEIGHT }}
          />
        )
      ),
    [wave, overviewBars, slim, detail],
  )
  const ticks = useMemo(
    () =>
      barLines(grid)
        .filter((_, i) => i % PHRASE_BARS === 0)
        .map((b, i) => (
          <span
            key={b.ms}
            data-testid="cue-wave-tick"
            data-strong={i % PHRASES_PER_STRONG_TICK === 0 ? 'true' : 'false'}
            aria-hidden="true"
            style={{ left: `${(b.ms / Math.max(durationMs, 1)) * 100}%` }}
            className={`absolute bottom-0 w-px ${
              i % PHRASES_PER_STRONG_TICK === 0
                ? 'h-[5px] bg-[var(--color-fg-dim)]'
                : 'h-[3px] bg-[var(--color-fg-faint)]'
            }`}
          />
        )),
    [grid, durationMs],
  )
  if (grid.length === 0) {
    return (
      <div
        data-testid="cue-wave-not-analysed"
        className="flex h-16 w-full items-center justify-center rounded-md bg-[var(--color-panel-2)] px-4 text-center text-xs text-[var(--color-fg-faint)]"
      >
        {t('cueWave.notAnalysed')}
      </div>
    )
  }
  const { hot, calls } = placeCues(cues, durationMs)
  const pendingOf = new Map(cues.map((c) => [c.key, c.pending]))
  const ghost = visibleGhost(rawGhost, cues)
  const pct = (ms: number): string => `${(ms / Math.max(durationMs, 1)) * 100}%`
  const viewPct = (ms: number): string =>
    `${Math.round((ms / Math.max(durationMs, 1)) * 1e6) / 1e4}%`
  const gone = new Set(ghost?.gone ?? [])
  const ghostMarks = ghost ? placeCues(ghost.added, durationMs) : null
  const shown = view && {
    from: Math.max(view.fromMs, 0),
    to: Math.min(view.toMs, durationMs),
  }
  const selectMark = (key: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect?.(key)
  }
  const markMenu = (key: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onMarkMenu?.({ key, clientX: e.clientX, clientY: e.clientY })
  }
  return (
    <div
      ref={rootRef}
      data-testid="cue-wave"
      role="application"
      aria-label={t('cueWave.label')}
      tabIndex={-1}
      onMouseDown={(e) => {
        if (readOnly || !onSeek || e.button !== 0 || e.ctrlKey) return
        sought.current = seekAt(e.clientX)
        onSeek(sought.current)
        setSeeking(true)
      }}
      onContextMenu={(e) => {
        if (readOnly) return
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        onMenu?.({
          ms: snapMs[nearestBeat(snapMs, msAtX(e.clientX))],
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        })
      }}
      className={`relative w-full overflow-hidden outline-none focus-visible:shadow-none ${
        slim ? 'h-[44px]' : 'h-11 rounded-md bg-[var(--color-panel-2)]'
      } ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}
    >
      <div
        data-testid="cue-wave-area"
        aria-hidden="true"
        style={{ top: '0px', bottom: '0px' }}
        className="pointer-events-none absolute inset-x-0"
      >
        {shown && (
          <span
            data-testid="cue-wave-view"
            style={{ left: viewPct(shown.from), width: viewPct(shown.to - shown.from) }}
            className="absolute top-0 bottom-0 bg-[var(--color-fg)]/10"
          />
        )}
        {waveSvg}
        {ticks}
        {cursorMs !== undefined && (
          <span
            data-testid="cue-wave-cursor"
            style={{ left: pct(cursorMs) }}
            className="absolute top-0 bottom-0 w-px bg-[var(--color-fg)]/40"
          />
        )}
        {(anchors ?? []).map((ms) => (
          <span
            key={`anchor${ms}`}
            data-testid={`cue-wave-anchor-${Math.round(ms)}`}
            aria-hidden="true"
            style={{ left: pct(ms) }}
            className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-[var(--color-accent)]"
          />
        ))}
        {playheadMs !== undefined && (
          <span
            data-testid="cue-wave-playhead"
            style={{ left: pct(playheadMs) }}
            className="absolute top-0 bottom-0 w-px bg-[var(--color-fg)]"
          />
        )}
      </div>
      {(trimmed ?? []).map((ms) => (
        <span
          key={`t${ms}`}
          data-testid={`cue-wave-trimmed-${ms}`}
          aria-hidden="true"
          style={markStyle((ms / Math.max(durationMs, 1)) * 100)}
          className="absolute h-3 w-3 rounded-[3px] border border-dashed border-[var(--color-fg-faint)]"
        />
      ))}
      {!readOnly &&
        (proposals ?? []).map(({ ms, sure }) => (
          <span
            key={`p${ms}`}
            data-testid={`cue-wave-proposal-${ms}`}
            data-sure={sure ? 'true' : 'false'}
            aria-hidden="true"
            style={{ left: pct(ms) }}
            className={`pointer-events-none absolute top-0 bottom-0 border-l border-[var(--color-accent)] ${
              sure ? '' : 'border-dashed'
            }`}
          />
        ))}
      {!readOnly &&
        onDropProposal &&
        (proposals ?? []).map(({ ms }) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: a pointer-only reveal of the ✕ over a thin line; the same suggestion is accepted or removed by keyboard from its pill on the zoomed wave
          <span
            key={`ph${ms}`}
            data-testid={`cue-wave-suggestion-hit-${ms}`}
            style={{ left: pct(ms) }}
            onMouseEnter={() => setHoverProposal(ms)}
            onMouseLeave={() => setHoverProposal(null)}
            className="absolute top-0 bottom-0 z-[5] w-3 -translate-x-1/2"
          >
            {hoverProposal === ms && (
              <CueDeleteBadge
                testId={`cue-wave-suggestion-drop-${ms}`}
                label={t('editor.cues.auto.drop')}
                onDelete={() => {
                  setHoverProposal(null)
                  onDropProposal(ms)
                }}
                className={
                  ms / Math.max(durationMs, 1) > 0.95 ? 'top-0 right-full' : 'top-0 left-full'
                }
              />
            )}
          </span>
        ))}
      {calls.map((c) => {
        const pending = pendingOf.get(c.key) ?? false
        const isSelected = selected === c.key
        const common = {
          'data-testid': `cue-wave-call-${c.ms}`,
          'data-off-grid': offGrid?.includes(c.key) ? 'true' : 'false',
          'data-gone': gone.has(c.key) ? 'true' : 'false',
          'data-paired': c.paired ? 'true' : 'false',
          'data-pending': pending ? 'true' : 'false',
          'data-selected': isSelected ? 'true' : 'false',
          style: {
            ...markStyle(c.at),
            borderTopColor: offGrid?.includes(c.key) ? 'var(--color-warn)' : MEMORY_CUE_COLOR,
            ...(gone.has(c.key) ? { opacity: GONE_OPACITY } : {}),
          },
          className: `absolute z-10 h-0 w-0 border-x-4 border-x-transparent after:absolute after:-left-3 after:h-6 after:w-6 after:content-[''] ${
            isSelected ? 'border-t-[9px] after:-top-[9px]' : 'border-t-[6px] after:-top-[6px]'
          }`,
        }
        return readOnly ? (
          <span key={`c${c.key}`} aria-hidden="true" {...common} />
        ) : (
          <button
            key={`c${c.key}`}
            type="button"
            aria-label={t('cueWave.call', { time: formatTime(c.ms / 1000) })}
            onClick={(e) => selectMark(c.key, e)}
            onContextMenu={(e) => markMenu(c.key, e)}
            {...common}
          />
        )
      })}
      {hot.map((h) => {
        const pending = pendingOf.get(h.key) ?? false
        const isSelected = selected === h.key
        const common = {
          'data-testid': `cue-wave-hot-${h.letter}`,
          'data-off-grid': offGrid?.includes(h.key) ? 'true' : 'false',
          'data-gone': gone.has(h.key) ? 'true' : 'false',
          'data-pending': pending ? 'true' : 'false',
          'data-selected': isSelected ? 'true' : 'false',
          style: {
            ...markStyle(h.at),
            backgroundColor: h.colour,
            color: '#000',
            ...(gone.has(h.key) ? { opacity: GONE_OPACITY } : {}),
          },
          className: `absolute z-10 h-3 w-3 rounded-[3px] text-center text-label font-semibold leading-3 after:absolute after:left-1/2 after:top-0 after:h-6 after:w-6 after:-translate-x-1/2 after:content-[''] ${
            isSelected
              ? 'ring-2 ring-[var(--color-fg)]'
              : offGrid?.includes(h.key)
                ? 'ring-2 ring-[var(--color-warn)]'
                : ''
          }`,
        }
        return readOnly ? (
          <span key={`h${h.key}`} aria-hidden="true" {...common}>
            {h.letter}
          </span>
        ) : (
          <button
            key={`h${h.key}`}
            type="button"
            aria-label={t('cueWave.hotCue', { letter: h.letter })}
            onClick={(e) => selectMark(h.key, e)}
            onContextMenu={(e) => markMenu(h.key, e)}
            {...common}
          >
            {h.letter}
          </button>
        )
      })}
      {ghostMarks?.calls.map((c) => (
        <span
          key={`gc${c.key}`}
          data-testid={`cue-wave-ghost-call-${c.ms}`}
          aria-hidden="true"
          style={{ ...markStyle(c.at), borderTopColor: MEMORY_CUE_COLOR, opacity: GHOST_OPACITY }}
          className="pointer-events-none absolute z-10 h-0 w-0 border-x-4 border-x-transparent border-t-[6px]"
        />
      ))}
      {ghostMarks?.hot.map((h) => (
        <span
          key={`gh${h.key}`}
          data-testid={`cue-wave-ghost-hot-${h.letter}`}
          aria-hidden="true"
          style={{
            ...markStyle(h.at),
            backgroundColor: 'var(--color-panel-2)',
            borderColor: h.colour,
            borderStyle: 'solid',
            borderWidth: '1.5px',
          }}
          className="pointer-events-none absolute z-10 h-3 w-3 rounded-[3px] text-center text-[10px] font-semibold leading-[9px] text-[var(--color-fg)]"
        >
          {h.letter}
        </span>
      ))}
      {(ghost?.rejected ?? [])
        .filter(
          (r, i, all) =>
            r.ms >= 0 && r.ms <= durationMs && all.findIndex((o) => o.ms === r.ms) === i,
        )
        .map((r) => (
          <span
            key={`gd${r.ms}`}
            data-testid={`cue-wave-ghost-dropped-${r.ms}`}
            aria-hidden="true"
            style={droppedStyle((r.ms / Math.max(durationMs, 1)) * 100, r)}
            className="pointer-events-none absolute z-10 h-3 w-3 rounded-[3px] border"
          />
        ))}
    </div>
  )
}
