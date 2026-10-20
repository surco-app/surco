import type React from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CueQuantize } from '../../../shared/cueQuantize'
import { nearestBeat } from '../../../shared/cueRules'
import { MEMORY_CUE_COLOR } from '../../../shared/rekordboxCueColors'
import type { CueWaveColumn } from '../../../shared/types'
import { type CueGhost, GHOST_OPACITY, GONE_OPACITY, markStyle, placeCues } from '../lib/cueMarks'
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
  onPlace,
  onSelect,
  onMove,
  onMenu,
  onMarkMenu,
  onAcceptProposal,
  playheadMs,
  onSeek,
  onOpen,
  view,
  onHover,
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
  onPlace?: (ms: number) => void
  onSelect?: (key: string | null) => void
  onMove?: (key: string, ms: number) => void
  onMenu?: (at: { ms: number; x: number; y: number }) => void
  onMarkMenu?: (at: { key: string; clientX: number; clientY: number }) => void
  onAcceptProposal?: (ms: number) => void
  playheadMs?: number
  onSeek?: (ms: number) => void
  onOpen?: (ms: number) => void
  view?: { fromMs: number; toMs: number }
  onHover?: (ms: number | null) => void
  ghost?: CueGhost
}): React.JSX.Element {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const swallowClick = useRef(false)
  const [cursor, setCursor] = useState<number | null>(null)
  const [press, setPress] = useState<number | null>(null)
  const dragged = useRef(false)
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
    if (readOnly) setCursor(null)
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
  useEffect(() => {
    if (press === null) return
    const move = (e: MouseEvent) => {
      if (Math.abs(e.clientX - press) <= DRAG_PX) return
      dragged.current = true
      setPress(null)
      setSeeking(true)
      latest.current.onSeek?.(msAtX(e.clientX))
    }
    const up = () => setPress(null)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [press, msAtX])
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
        dragged.current = false
        if (onPlace) {
          setPress(e.clientX)
          return
        }
        onSeek(msAtX(e.clientX))
        setSeeking(true)
      }}
      onClick={(e) => {
        if (readOnly || swallowClick.current) return
        if (dragged.current) {
          dragged.current = false
          return
        }
        if (onPlace) {
          setCursor(null)
          onHover?.(null)
          onSelect?.(null)
          onPlace(snapAt(e.clientX))
          return
        }
        if (onSeek) {
          onSeek(msAtX(e.clientX))
          return
        }
        onOpen?.(msAtX(e.clientX))
      }}
      onKeyDown={(e) => {
        if (readOnly || e.target !== e.currentTarget || e.key !== 'Enter' || cursor === null) return
        onPlace?.(cursor)
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
        if (readOnly || !onPlace || seeking) return
        const ms = snapAt(e.clientX)
        setCursor(ms)
        onHover?.(ms)
      }}
      onMouseLeave={() => {
        setCursor(null)
        onHover?.(null)
      }}
      className={`relative h-16 w-full overflow-hidden rounded-md bg-[var(--color-panel-2)] ${
        readOnly ? 'cursor-default' : onPlace ? 'cursor-crosshair' : 'cursor-pointer'
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
      {cursor !== null && (
        <span
          data-testid="cue-wave-cursor"
          aria-hidden="true"
          style={{ left: pct(cursor) }}
          className="pointer-events-none absolute top-0 bottom-0 w-px bg-[var(--color-fg)]/80"
        />
      )}
    </div>
  )
}
