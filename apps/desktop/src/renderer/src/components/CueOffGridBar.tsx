import type React from 'react'
import { useTranslation } from 'react-i18next'
import { cueClock } from '../lib/cuePlayhead'
import { cueLetter } from '../lib/rowCues'

export interface OffGridCue {
  kind: number
  ms: number
  driftMs: number
}

function chipsOf(
  off: OffGridCue[],
  call: string,
): { ms: number; label: string; driftMs: number }[] {
  const byMs = new Map<number, OffGridCue[]>()
  for (const c of off) byMs.set(c.ms, [...(byMs.get(c.ms) ?? []), c])
  return [...byMs.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ms, cues]) => ({
      ms,
      driftMs: cues[0].driftMs,
      label: [...cues]
        .sort((a, b) => b.kind - a.kind)
        .map((c) => (c.kind === 0 ? call : cueLetter(c.kind)))
        .join(' + '),
    }))
}

export function CueOffGridBar({
  off,
  onGo,
  onSnap,
  spaced,
}: {
  off: OffGridCue[]
  onGo: (ms: number) => void
  onSnap: () => void
  spaced?: boolean
}): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  if (off.length === 0) return null
  return (
    <div
      data-testid="cues-offgrid"
      className={`${spaced ? 'mb-2' : 'shrink-0'} flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10 px-3 py-1.5 text-xs`}
    >
      <span className="whitespace-nowrap font-semibold text-fg">
        {tr('editor.cues.offGrid.count', { count: off.length })}
      </span>
      {chipsOf(off, tr('editor.cues.selectedCall')).map((chip) => (
        <button
          key={chip.ms}
          type="button"
          data-testid={`cues-offgrid-go-${chip.ms}`}
          title={tr('editor.cues.offGrid.go')}
          onClick={() => onGo(chip.ms)}
          className="press flex h-6 items-center gap-2 whitespace-nowrap rounded-md border border-[var(--color-warn)]/50 bg-[var(--color-panel)] px-2 tabular-nums text-fg hover:bg-[var(--color-hover)]"
        >
          <span className="font-semibold">{chip.label}</span>
          {cueClock(chip.ms)}
          <span className="text-warn">
            {tr(chip.driftMs < 0 ? 'editor.cues.offGrid.before' : 'editor.cues.offGrid.after', {
              ms: Math.round(Math.abs(chip.driftMs)),
            })}
          </span>
        </button>
      ))}
      <span className="flex-1" />
      <button
        type="button"
        data-testid="cues-offgrid-snap"
        onClick={onSnap}
        className="press flex h-6 shrink-0 items-center whitespace-nowrap rounded-md bg-[var(--color-accent)] px-2.5 font-semibold text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
      >
        {tr('editor.cues.offGrid.snap')}
      </button>
    </div>
  )
}
