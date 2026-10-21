import type React from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CueQuantize } from '../../../shared/cueQuantize'
import { nearestBeat } from '../../../shared/cueRules'
import { MEMORY_CUE_COLOR } from '../../../shared/rekordboxCueColors'
import type { CueWaveColumn } from '../../../shared/types'
import {
  CURSOR_LINE,
  type CueGhost,
  droppedStyle,
  GHOST_OPACITY,
  GONE_OPACITY,
  HOT_MARK_PX,
  markStyle,
  placeCues,
} from '../lib/cueMarks'
import { snapToBeat } from '../lib/cuePlayhead'
import { barLines, cuePosition, peakBars, quantizePoints } from '../lib/cueWave'
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
const WAVE_TOP = '10%'

export function CueWave({
  wave,
  grid,
  quantize = 'beat',
  durationMs,
  cues,
  selected,
  proposals,
  trimmed,
  readOnly,
  onSelect,
  onMenu,
  onMarkMenu,
  onAcceptProposal,
  playheadMs,
  onSeek,
  slim,
  view,
  onHover,
  hoverMs,
  ghost,
}: {
  wave: CueWaveColumn[] | null
  grid: { ms: number; beat: number }[]
  quantize?: CueQuantize
  durationMs: number
  cues: WaveCue[]
  selected?: string | null
  proposals?: number[]
  trimmed?: number[]
  readOnly?: boolean
  onSelect?: (key: string | null) => void
  onMenu?: (at: { ms: number; x: number; y: number }) => void
  onMarkMenu?: (at: { key: string; clientX: number; clientY: number }) => void
  onAcceptProposal?: (ms: number) => void
  playheadMs?: number
  onSeek?: (ms: number) => void
  slim?: boolean
  view?: { fromMs: number; toMs: number }
  onHover?: (ms: number | null) => void
  hoverMs?: number | null
  ghost?: CueGhost
}): React.JSX.Element {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const [seeking, setSeeking] = useState(false)
  const sought = useRef<number | null>(null)
  const [stripPx, setStripPx] = useState(0)
  const analysed = grid.length > 0
  const snapMs = quantizePoints(grid, quantize)
  const latest = useRef({ durationMs, onSeek, onHover })
  latest.current = { durationMs, onSeek, onHover }
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
  useEffect(() => {
    if (readOnly) setCursor(null)
  }, [readOnly])
  const hovering = onHover !== undefined
  useEffect(() => {
    if (!hovering) setCursor(null)
  }, [hovering])
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
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [seeking, seekAt])
  const waveSvg = useMemo(
    () =>
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
      ),
    [wave, overviewBars, slim],
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
  const line = cursor ?? hoverMs ?? null
  const pct = (ms: number): string => `${(ms / Math.max(durationMs, 1)) * 100}%`
  const viewPct = (ms: number): string =>
    `${Math.round((ms / Math.max(durationMs, 1)) * 1e6) / 1e4}%`
  const snapAt = (clientX: number): number => snapMs[nearestBeat(snapMs, msAtX(clientX))]
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
      tabIndex={readOnly ? -1 : 0}
      onMouseDown={(e) => {
        if (readOnly || !onSeek || e.button !== 0 || e.ctrlKey) return
        setCursor(null)
        onHover?.(null)
        sought.current = seekAt(e.clientX)
        onSeek(sought.current)
        setSeeking(true)
      }}
      onClick={(e) => {
        if (readOnly) return
        if (onSeek && sought.current === null) onSeek(seekAt(e.clientX))
        sought.current = null
      }}
      onKeyDown={(e) => {
        if (readOnly || e.target !== e.currentTarget || e.key !== 'Enter' || cursor === null) return
        onSeek?.(cursor)
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
      onMouseMove={(e) => {
        if (readOnly || !onHover || seeking) return
        const ms = snapAt(e.clientX)
        setCursor(ms)
        onHover?.(ms)
      }}
      onMouseLeave={() => {
        setCursor(null)
        onHover?.(null)
      }}
      className={`relative w-full overflow-hidden ${
        slim ? 'h-[44px]' : 'h-16 rounded-md bg-[var(--color-panel-2)]'
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
        (proposals ?? []).map((ms) => (
          <button
            key={`p${ms}`}
            type="button"
            data-testid={`cue-wave-proposal-${ms}`}
            aria-label={t('cueWave.proposal', { bar: cuePosition(ms, grid).bar })}
            style={{ left: pct(ms), top: WAVE_TOP }}
            className="absolute bottom-0 w-2 -translate-x-1/2 border-l border-dashed border-[var(--color-fg)]/70"
            onClick={(e) => {
              e.stopPropagation()
              onAcceptProposal?.(ms)
            }}
          />
        ))}
      {calls.map((c) => {
        const pending = pendingOf.get(c.key) ?? false
        const isSelected = selected === c.key
        const common = {
          'data-testid': `cue-wave-call-${c.ms}`,
          'data-gone': gone.has(c.key) ? 'true' : 'false',
          'data-paired': c.paired ? 'true' : 'false',
          'data-pending': pending ? 'true' : 'false',
          'data-selected': isSelected ? 'true' : 'false',
          style: {
            ...markStyle(c.at),
            borderTopColor: MEMORY_CUE_COLOR,
            ...(gone.has(c.key) ? { opacity: GONE_OPACITY } : {}),
          },
          className: `absolute z-10 h-0 w-0 border-x-4 border-x-transparent ${
            isSelected ? 'border-t-[9px]' : 'border-t-[6px]'
          } ${pending ? 'opacity-60' : ''}`,
        }
        return readOnly ? (
          <span key={`c${c.key}`} aria-hidden="true" {...common} />
        ) : (
          <button
            key={`c${c.key}`}
            type="button"
            aria-label={t('cueWave.call')}
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
          'data-gone': gone.has(h.key) ? 'true' : 'false',
          'data-pending': pending ? 'true' : 'false',
          'data-selected': isSelected ? 'true' : 'false',
          style: {
            ...markStyle(h.at),
            ...(pending
              ? { borderColor: h.colour, color: h.colour }
              : { backgroundColor: h.colour, color: '#000' }),
            ...(gone.has(h.key) ? { opacity: GONE_OPACITY } : {}),
          },
          className: `absolute z-10 h-3 w-3 rounded-[3px] text-center text-[9px] font-semibold leading-3 ${
            pending ? 'border' : ''
          } ${isSelected ? 'ring-2 ring-[var(--color-fg)]' : ''}`,
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
            backgroundColor: h.colour,
            color: '#000',
            opacity: GHOST_OPACITY,
          }}
          className="pointer-events-none absolute z-10 h-3 w-3 rounded-[3px] text-center text-[9px] font-semibold leading-3"
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
      {line !== null && (
        <span
          data-testid="cue-wave-cursor"
          aria-hidden="true"
          style={{ ...CURSOR_LINE, left: pct(line) }}
          className="pointer-events-none absolute top-0 bottom-0"
        />
      )}
    </div>
  )
}
