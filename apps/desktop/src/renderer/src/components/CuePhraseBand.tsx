import type React from 'react'
import type { PhraseKind, PhraseSection } from '../../../shared/cueFlows'

const TONE: Record<PhraseKind, string> = {
  chorus: 'bg-[var(--color-accent)]/70 text-[var(--color-on-accent)]',
  up: 'bg-[var(--color-accent)]/30 text-fg',
  down: 'bg-[var(--color-fg-faint)]/15 text-fg-dim',
  intro: 'bg-[var(--color-fg-faint)]/15 text-fg-dim',
  outro: 'bg-[var(--color-fg-faint)]/15 text-fg-dim',
}

const LABELLED_SHARE = 0.035

export function CuePhraseBand({
  sections,
  durationMs,
}: {
  sections: PhraseSection[]
  durationMs: number
}): React.JSX.Element | null {
  if (sections.length === 0 || durationMs <= 0) return null
  const runs: (PhraseSection & { end: number })[] = []
  sections.forEach((s, i) => {
    const end = sections[i + 1]?.ms ?? durationMs
    const last = runs[runs.length - 1]
    if (last?.label === s.label) last.end = end
    else runs.push({ ...s, end })
  })
  const pct = (ms: number): string => `${(ms / durationMs) * 100}%`
  return (
    <div data-testid="cue-phrases" className="relative h-5 shrink-0">
      {runs.map((r) => (
        <div
          key={r.ms}
          data-testid="cue-phrase"
          data-kind={r.kind}
          style={{ left: pct(r.ms), width: pct(r.end - r.ms) }}
          className="absolute inset-y-0 pr-0.5"
        >
          <div
            className={`h-full truncate rounded-[3px] px-1.5 text-[11px] leading-5 ${TONE[r.kind]}`}
          >
            {(r.end - r.ms) / durationMs >= LABELLED_SHARE ? r.label : ''}
          </div>
        </div>
      ))}
    </div>
  )
}
