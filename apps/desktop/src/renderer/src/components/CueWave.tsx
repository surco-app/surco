import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { nearestBeat } from '../../../shared/cueRules'
import { MEMORY_CUE_COLOR } from '../../../shared/rekordboxCueColors'
import type { CueWaveColumn } from '../../../shared/types'
import { markStyle, placeCues } from '../lib/cueMarks'
import { barLines, clickAction, cuePosition, dropLabels } from '../lib/cueWave'

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

export function CueWave({
  wave,
  grid,
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
  onAcceptProposal,
}: {
  wave: CueWaveColumn[] | null
  grid: { ms: number; beat: number }[]
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
  onAcceptProposal?: (ms: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const swallowClick = useRef(false)
  const [ghost, setGhost] = useState<number | null>(null)
  const dragRef = useRef<{ key: string; x0: number; ms: number | null } | null>(null)
  const [dragMs, setDragMs] = useState<number | null>(null)
  const [armed, setArmed] = useState(false)
  const beatsMs = grid.map((b) => b.ms)
  const latest = useRef({ beatsMs, durationMs, onMove })
  latest.current = { beatsMs, durationMs, onMove }
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
      const beats = latest.current.beatsMs
      d.ms = beats[nearestBeat(beats, msAtX(e.clientX))]
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
  if (grid.length === 0) {
    return (
      <div
        data-testid="cue-wave-not-analysed"
        className="flex h-20 w-full items-center justify-center rounded-md bg-[var(--color-panel-2)] px-4 text-center text-xs text-[var(--color-fg-faint)]"
      >
        {t('cueWave.notAnalysed')}
      </div>
    )
  }
  const { hot, calls } = placeCues(cues, durationMs)
  const pendingOf = new Map(cues.map((c) => [c.key, c.pending]))
  const drops = calls.filter((c) => !c.paired)
  const labels = new Map(
    dropLabels(
      drops.map((d) => d.ms),
      durationMs,
    ).map((l) => [l.ms, l]),
  )
  const sideClass = (side: 'left' | 'right' | undefined): string =>
    side === 'left' ? 'right-1 text-right' : 'left-1'
  const pct = (ms: number): string => `${(ms / Math.max(durationMs, 1)) * 100}%`
  const at = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ms = msAtX(e.clientX)
    const tolerance = (HIT_PX / Math.max(rect.width, 1)) * durationMs
    const action = clickAction(
      ms,
      beatsMs,
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
  return (
    <div
      ref={rootRef}
      data-testid="cue-wave"
      role="application"
      aria-label={t('cueWave.label')}
      tabIndex={readOnly ? -1 : 0}
      onClick={(e) => {
        if (readOnly || swallowClick.current) return
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
          ms: beatsMs[nearestBeat(beatsMs, msAtX(e.clientX))],
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        })
      }}
      onMouseMove={(e) => {
        if (readOnly) return
        const action = at(e)
        setGhost(action.kind === 'add' ? action.ms : null)
      }}
      onMouseLeave={() => setGhost(null)}
      className={`relative h-20 w-full overflow-hidden rounded-md bg-[var(--color-panel-2)] ${
        readOnly ? 'cursor-default' : 'cursor-crosshair'
      }`}
    >
      {wave && (
        <svg
          viewBox={`0 0 ${wave.length} 100`}
          preserveAspectRatio="none"
          aria-hidden="true"
          className="absolute inset-0 h-full w-full"
        >
          {wave.map((c, i) => (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
              key={i}
              x={i}
              width={1}
              y={50 - c.h * 50}
              height={Math.max(c.h * 100, 0.5)}
              fill={c.rgb ? `rgb(${c.rgb.join(',')})` : 'var(--color-fg-faint)'}
            />
          ))}
        </svg>
      )}
      {barLines(grid).map((b) => (
        <span
          key={b.ms}
          data-testid="cue-wave-bar"
          data-strong={b.strong ? 'true' : 'false'}
          aria-hidden="true"
          style={{ left: pct(b.ms) }}
          className={`absolute top-0 bottom-0 w-px ${
            b.strong ? 'bg-[var(--color-fg)]/40' : 'bg-[var(--color-fg)]/10'
          }`}
        />
      ))}
      {drops.map((d) => {
        const label = labels.get(d.ms)
        const position = cuePosition(d.ms, grid)
        return (
          <span
            key={`d${d.key}`}
            data-testid={`cue-wave-drop-${d.ms}`}
            data-pending={pendingOf.get(d.key) ? 'true' : 'false'}
            style={{ left: pct(d.ms) }}
            className={`absolute top-0 bottom-0 w-0.5 bg-[var(--color-fg)] ${
              pendingOf.get(d.key) ? 'opacity-60' : ''
            }`}
          >
            <span
              data-testid={`cue-wave-drop-label-${d.ms}`}
              data-side={label?.side ?? 'right'}
              data-row={label?.row ?? 0}
              className={`absolute whitespace-nowrap text-[9px] leading-[11px] text-[var(--color-fg)] ${
                label?.row === 1 ? 'bottom-6' : 'bottom-0'
              } ${sideClass(label?.side)}`}
            >
              <span className="block font-semibold">DROP {position.bar}</span>
              <span className="block tabular-nums">{position.time}</span>
            </span>
          </span>
        )
      })}
      {(trimmed ?? []).map((ms) => (
        <span
          key={`t${ms}`}
          data-testid={`cue-wave-trimmed-${ms}`}
          aria-hidden="true"
          style={markStyle((ms / Math.max(durationMs, 1)) * 100, 'hot', 'wave')}
          className="absolute h-3.5 w-3.5 rounded-[3px] border border-dashed border-[var(--color-fg-faint)]"
        />
      ))}
      {!readOnly &&
        (proposals ?? []).map((ms) => (
          <button
            key={`p${ms}`}
            type="button"
            data-testid={`cue-wave-proposal-${ms}`}
            aria-label={t('cueWave.proposal', { bar: cuePosition(ms, grid).bar })}
            style={{ left: pct(ms) }}
            className="absolute top-0 bottom-0 w-2 -translate-x-1/2 border-l border-dashed border-[var(--color-fg)]/70"
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
          'data-selected': isSelected ? 'true' : 'false',
          style: { ...markStyle(c.at, 'call', 'wave'), borderTopColor: MEMORY_CUE_COLOR },
          className: `absolute h-0 w-0 border-x-[5px] border-x-transparent ${
            isSelected ? 'border-t-[10px]' : 'border-t-[7px]'
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
            ...markStyle(h.at, 'hot', 'wave'),
            ...(pending
              ? { borderColor: h.colour, color: h.colour }
              : { backgroundColor: h.colour, color: '#000' }),
          },
          className: `absolute h-3.5 w-3.5 rounded-[3px] text-center text-[9px] font-bold leading-[14px] ${
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
          style={{ left: pct(ghost) }}
          className="pointer-events-none absolute top-0 bottom-0 w-px border-l border-dashed border-[var(--color-fg)]/70"
        >
          <span
            className={`absolute bottom-4 whitespace-nowrap text-[9px] leading-[11px] text-[var(--color-fg)]/80 ${sideClass(
              dropLabels([ghost], durationMs)[0]?.side,
            )}`}
          >
            <span className="block">+ drop {cuePosition(ghost, grid).bar}</span>
            <span className="block tabular-nums">{cuePosition(ghost, grid).time}</span>
          </span>
        </span>
      )}
    </div>
  )
}
