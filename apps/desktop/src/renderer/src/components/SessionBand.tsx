import { Sparkles } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionPlan } from '../../../shared/sessionBuild'

const BUTTON =
  'press rounded-lg border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-hover)] disabled:opacity-50'

function clock(secs: number): string {
  const minutes = Math.floor(secs / 60)
  return `${minutes}:${String(Math.floor(secs % 60)).padStart(2, '0')}`
}

export function SessionBand({
  plan,
  busy,
  onRedo,
  onAdjust,
  onKeep,
}: {
  plan: SessionPlan
  busy: boolean
  onRedo: () => void
  onAdjust: () => void
  onKeep: () => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const { summary } = plan
  return (
    <section
      data-testid="session-band"
      aria-label={tr('sessions.band.title')}
      className="mx-3 mb-2 flex flex-col gap-2 rounded-[10px] border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-3"
    >
      <h2 className="flex items-center gap-2 text-[13px] font-semibold">
        <Sparkles className="h-3.5 w-3.5 text-[var(--color-accent)]" aria-hidden="true" />
        {tr('sessions.band.title')}
      </h2>
      <p
        data-testid="session-band-stats"
        className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-dim"
      >
        <b className="font-semibold text-fg tabular-nums">{clock(summary.secs)}</b>
        <span>{tr('sessions.band.tracks', { count: summary.tracks })}</span>
        <span>{tr('sessions.band.combos', { count: summary.combos })}</span>
        <span>{tr('sessions.band.fresh', { count: summary.fresh })}</span>
        {summary.withKey > 0 && (
          <span>
            {tr('sessions.band.harmonic', {
              harmonic: summary.harmonic,
              total: summary.withKey,
            })}
          </span>
        )}
      </p>
      {summary.shortBySecs > 0 && (
        <p data-testid="session-band-short" className="text-xs text-warn">
          {tr('sessions.band.short', { minutes: Math.round(summary.secs / 60) })}
        </p>
      )}
      {summary.missingDurations > 0 && (
        <p data-testid="session-band-assumed" className="text-xs text-fg-dim">
          {tr('sessions.band.assumed', { count: summary.missingDurations })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="session-band-redo"
          disabled={busy}
          onClick={onRedo}
          className={BUTTON}
        >
          {tr('sessions.band.redo')}
        </button>
        <button
          type="button"
          data-testid="session-band-adjust"
          disabled={busy}
          onClick={onAdjust}
          className={BUTTON}
        >
          {tr('sessions.band.adjust')}
        </button>
        <button
          type="button"
          data-testid="session-band-keep"
          disabled={busy}
          onClick={onKeep}
          className="press px-2 py-1.5 text-xs font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] disabled:opacity-50"
        >
          {tr('sessions.band.keep')}
        </button>
      </div>
    </section>
  )
}
