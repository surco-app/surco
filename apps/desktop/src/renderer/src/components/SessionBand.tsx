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

function audioLabel(secs: number): string {
  const minutes = Math.round(secs / 60)
  if (minutes < 60) return `${minutes}\u00a0min`
  return `${Math.floor(minutes / 60)}\u00a0h\u00a0${String(minutes % 60).padStart(2, '0')}\u00a0min`
}

const UNKNOWN_MINUTES = 6

export function SessionBand({
  plan,
  busy,
  playMinutes,
  preferCombos,
  onRedo,
  onAdjust,
  onKeep,
}: {
  plan: SessionPlan
  busy: boolean
  playMinutes: number
  preferCombos: boolean
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
      className="mx-3 my-2 flex flex-col gap-2 rounded-[10px] border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-3"
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
        {summary.combos > 0 && <span>{tr('sessions.band.combos', { count: summary.combos })}</span>}
        {summary.fresh > 0 && <span>{tr('sessions.band.fresh', { count: summary.fresh })}</span>}
        {summary.withKey > 0 && (
          <span>
            {tr('sessions.band.harmonic', {
              harmonic: summary.harmonic,
              total: summary.withKey,
            })}
          </span>
        )}
      </p>
      <p data-testid="session-band-counted" className="text-xs text-fg-dim">
        {tr(
          summary.missingDurations > 0 ? 'sessions.band.countedAtLeast' : 'sessions.band.counted',
          {
            minutes: playMinutes,
            audio: audioLabel(summary.audioSecs),
          },
        )}
      </p>
      {preferCombos && summary.combos === 0 && (
        <p data-testid="session-band-nocombos" className="text-xs text-fg-dim">
          {tr('sessions.band.noCombos')}
        </p>
      )}
      {summary.shortBySecs > 0 && (
        <p data-testid="session-band-short" className="text-xs text-warn">
          {tr('sessions.band.short', { minutes: Math.round(summary.secs / 60) })}
        </p>
      )}
      {summary.missingDurations > 0 && (
        <p data-testid="session-band-assumed" className="text-xs text-fg-dim">
          {tr('sessions.band.assumed', {
            count: summary.missingDurations,
            minutes: Math.min(UNKNOWN_MINUTES, playMinutes),
          })}
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
