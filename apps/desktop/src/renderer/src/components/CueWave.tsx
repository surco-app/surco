import type React from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CueQuantize } from '../../../shared/cueQuantize'
import { nearestBeat } from '../../../shared/cueRules'
import { MEMORY_CUE_COLOR } from '../../../shared/rekordboxCueColors'
import type { CueWaveColumn } from '../../../shared/types'
import { markStyle, placeCues } from '../lib/cueMarks'
import { barLines, clickAction, cuePosition, peakBars, quantizePoints } from '../lib/cueWave'
import { WaveBars } from './WaveBars'

export interface WaveCue {
  key: string
  ms: number
  kind: number
  color: number | null
  pending: boolean
  locked?: boolean
}

const HIT_PX = 6
const DRAG_PX = 3
const OVERVIEW_BARS = 300
const ROW_BAR_PITCH_PX = 3
const WAVE_HEIGHT = '90%'
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
  onMarkDrop,
  onUnmarkDrop,
  onSelect,
  onMove,
  onMenu,
  onMarkMenu,
  onAcceptProposal,
  playheadMs,
  onSeek,
  view,
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
  onMarkDrop?: (ms: number) => void
  onUnmarkDrop?: (key: string) => void
  onSelect?: (key: string | null) => void
  onMove?: (key: string, ms: number) => void
  onMenu?: (at: { ms: number; x: number; y: number }) => void
  onMarkMenu?: (at: { key: string; clientX: number; clientY: number }) => void
  onAcceptProposal?: (ms: number) => void
  playheadMs?: number
  onSeek?: (ms: number) => void
  view?: { fromMs: number; toMs: number }
}): React.JSX.Element {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const swallowClick = useRef(false)
  const [ghost, setGhost] = useState<number | null>(null)
  const dragRef = useRef<{ key: string; x0: number; ms: number | null } | null>(null)
  const [dragMs, setDragMs] = useState<number | null>(null)
  const [armed, setArmed] = useState(false)
  const [seeking, setSeeking] = useState(false)
  const [stripPx, setStripPx] = useState(0)
  const analysed = grid.length > 0
  const snapMs = quantizePoints(grid, quantize)
  const latest = useRef({ snapMs, durationMs, onMove, onSeek })
  latest.current = { snapMs, durationMs, onMove, onSeek }
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
    if (readOnly) setGhost(null)
  }, [readOnly])
  const msAtX = useCallback((clientX: number): number => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return 0
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width)
    return (x / Math.max(rect.width, 1)) * latest.current.durationMs
  }, [])
  useEffect(() => {
    if (!armed) return
    const move = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d || Math.abs(e.clientX - d.x0) <= DRAG_PX) return
      const snap = latest.current.snapMs
      d.ms = snap[nearestBeat(snap, msAtX(e.clientX))]
      setDragMs(d.ms)
    }
    const up = () => {
      const d = dragRef.current
      dragRef.current = null
      setArmed(false)
      setDragMs(null)
      if (!d || d.ms === null) return
      swallowClick.current = true
      setTimeout(() => {
        swallowClick.current = false
      }, 0)
      latest.current.onMove?.(d.key, d.ms)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [armed, msAtX])
  useEffect(() => {
    if (!seeking) return
    const move = (e: MouseEvent) => latest.current.onSeek?.(msAtX(e.clientX))
    const up = () => setSeeking(false)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [seeking, msAtX])
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
          style={{ height: WAVE_HEIGHT }}
        />
      ),
    [wave, overviewBars],
  )
  const ticks = useMemo(
    () =>
      barLines(grid)
        .filter((b) => b.strong)
        .map((b) => (
          <span
            key={b.ms}
            data-testid="cue-wave-tick"
            aria-hidden="true"
            style={{ left: `${(b.ms / Math.max(durationMs, 1)) * 100}%` }}
            className="absolute bottom-0 h-[3px] w-px bg-[var(--color-fg-faint)]"
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
  const drops = calls.filter((c) => !c.paired)
  const pct = (ms: number): string => `${(ms / Math.max(durationMs, 1)) * 100}%`
  const viewPct = (ms: number): string =>
    `${Math.round((ms / Math.max(durationMs, 1)) * 1e6) / 1e4}%`
  const shown = view && {
    from: Math.max(view.fromMs, 0),
    to: Math.min(view.toMs, durationMs),
  }
  const at = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ms = msAtX(e.clientX)
    const tolerance = (HIT_PX / Math.max(rect.width, 1)) * durationMs
    const action = clickAction(
      ms,
      snapMs,
      drops.map((d) => d.ms),
      tolerance,
    )
    return { ...action, key: drops.find((d) => d.ms === action.ms)?.key }
  }
  const startDrag = (key: string, e: React.MouseEvent) => {
    if (e.button !== 0 || e.ctrlKey) return
    e.stopPropagation()
    onSelect?.(key)
    if (cues.some((c) => c.key === key && c.locked)) return
    dragRef.current = { key, x0: e.clientX, ms: null }
    setArmed(true)
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
        onSeek(msAtX(e.clientX))
        setSeeking(true)
      }}
      onClick={(e) => {
        if (readOnly || swallowClick.current) return
        if (onSeek) {
          onSeek(msAtX(e.clientX))
          return
        }
        setGhost(null)
        onSelect?.(null)
        const action = at(e)
        if (action.kind === 'remove' && action.key !== undefined) onUnmarkDrop?.(action.key)
        else onMarkDrop?.(action.ms)
      }}
      onKeyDown={(e) => {
        if (readOnly || e.target !== e.currentTarget || e.key !== 'Enter' || ghost === null) return
        onMarkDrop?.(ghost)
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
        if (readOnly || onSeek) return
        const action = at(e)
        setGhost(action.kind === 'add' ? action.ms : null)
      }}
      onMouseLeave={() => setGhost(null)}
      className={`relative h-16 w-full overflow-hidden rounded-md bg-[var(--color-panel-2)] ${
        readOnly ? 'cursor-default' : onSeek ? 'cursor-pointer' : 'cursor-crosshair'
      }`}
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
          'data-paired': c.paired ? 'true' : 'false',
          'data-pending': pending ? 'true' : 'false',
          'data-selected': isSelected ? 'true' : 'false',
          style: { ...markStyle(c.at), borderTopColor: MEMORY_CUE_COLOR },
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
            onMouseDown={(e) => startDrag(c.key, e)}
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
          'data-pending': pending ? 'true' : 'false',
          'data-selected': isSelected ? 'true' : 'false',
          style: {
            ...markStyle(h.at),
            ...(pending
              ? { borderColor: h.colour, color: h.colour }
              : { backgroundColor: h.colour, color: '#000' }),
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
            onMouseDown={(e) => startDrag(h.key, e)}
            onClick={(e) => selectMark(h.key, e)}
            onContextMenu={(e) => markMenu(h.key, e)}
            {...common}
          >
            {h.letter}
          </button>
        )
      })}
      {dragMs !== null && (
        <span
          data-testid="cue-wave-drag-ghost"
          aria-hidden="true"
          style={{ left: pct(dragMs) }}
          className="pointer-events-none absolute top-0 bottom-0 w-px bg-[var(--color-fg)]/70"
        />
      )}
      {ghost !== null && (
        <span
          data-testid="cue-wave-ghost"
          aria-hidden="true"
          style={{ left: pct(ghost), top: WAVE_TOP }}
          className="pointer-events-none absolute bottom-0 w-px border-l border-dashed border-[var(--color-fg)]/70"
        />
      )}
    </div>
  )
}
