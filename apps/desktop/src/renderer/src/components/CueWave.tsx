import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DrawnHotCue } from '../../../shared/cueRules'
import type { CueWaveColumn } from '../../../shared/types'
import { barLines, CUE_COLOR, clickAction, HOT_LETTER } from '../lib/cueWave'

const HIT_PX = 6

export function CueWave({
  wave,
  grid,
  durationMs,
  hot,
  drops,
  disabled,
  onAddDrop,
  onRemoveDrop,
}: {
  wave: CueWaveColumn[] | null
  grid: { ms: number; beat: number }[]
  durationMs: number
  hot: (DrawnHotCue & { pending: boolean })[]
  drops: { ms: number; pending: boolean }[]
  disabled?: boolean
  onAddDrop: (ms: number) => void
  onRemoveDrop: (ms: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [ghost, setGhost] = useState<number | null>(null)
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
  const beatsMs = grid.map((b) => b.ms)
  const pct = (ms: number): string => `${(ms / Math.max(durationMs, 1)) * 100}%`
  const at = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width)
    const ms = (x / Math.max(rect.width, 1)) * durationMs
    const tolerance = (HIT_PX / Math.max(rect.width, 1)) * durationMs
    return clickAction(
      ms,
      beatsMs,
      drops.map((d) => d.ms),
      tolerance,
    )
  }
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: marking a drop is pointer-only on this waveform; there is no keyboard path to it yet
    // biome-ignore lint/a11y/noStaticElementInteractions: the waveform is the marking surface itself, operated with the pointer only
    <div
      data-testid="cue-wave"
      onClick={(e) => {
        if (disabled) return
        const action = at(e)
        if (action.kind === 'remove') onRemoveDrop(action.ms)
        else onAddDrop(action.ms)
      }}
      onMouseMove={(e) => {
        if (disabled) return
        const action = at(e)
        setGhost(action.kind === 'add' ? action.ms : null)
      }}
      onMouseLeave={() => setGhost(null)}
      className={`relative h-20 w-full overflow-hidden rounded-md bg-[var(--color-panel-2)] ${
        disabled ? 'cursor-default' : 'cursor-crosshair'
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
      {drops.map((d) => (
        <span
          key={`d${d.ms}`}
          data-testid={`cue-wave-drop-${d.ms}`}
          data-pending={d.pending ? 'true' : undefined}
          style={{ left: pct(d.ms) }}
          className={`absolute top-0 bottom-0 w-0.5 bg-[var(--color-fg)] ${d.pending ? 'opacity-60' : ''}`}
        >
          <span className="absolute top-0 left-1 text-[9px] font-semibold text-[var(--color-fg)]">
            DROP
          </span>
        </span>
      ))}
      {hot.map((h) => (
        <span
          key={`h${h.kind}`}
          data-testid={`cue-wave-hot-${HOT_LETTER[h.kind]}`}
          data-pending={h.pending ? 'true' : undefined}
          style={{ left: pct(h.ms), backgroundColor: CUE_COLOR[h.color] }}
          className={`absolute top-0 bottom-0 w-0.5 ${h.pending ? 'opacity-50' : ''}`}
        >
          <span
            style={{ backgroundColor: CUE_COLOR[h.color] }}
            className="absolute bottom-0 left-0 rounded-sm px-1 text-[9px] font-bold text-[var(--color-panel)]"
          >
            {HOT_LETTER[h.kind]}
          </span>
        </span>
      ))}
      {ghost !== null && (
        <span
          data-testid="cue-wave-ghost"
          style={{ left: pct(ghost) }}
          className="pointer-events-none absolute top-0 bottom-0 w-px border-l border-dashed border-[var(--color-fg)]/70"
        >
          <span className="absolute top-3 left-1 text-[9px] text-[var(--color-fg)]/80">+ drop</span>
        </span>
      )}
    </div>
  )
}
