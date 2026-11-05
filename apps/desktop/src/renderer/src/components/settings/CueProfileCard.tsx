import { ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CueFlow, CueRule } from '../../../../shared/cueFlows'
import type { CueProfile, CueProfileRead } from '../../../../shared/cueProfile'
import { MIN_TASTE_TRACKS } from '../../../../shared/dropTaste'
import { hotCueColor } from '../../../../shared/rekordboxCueColors'
import type { SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
import { formatCount } from '../../lib/stats'
import { Tooltip } from '../Tooltip'
import { CheckboxRow } from './CheckboxRow'
import { SettingsHint } from './SettingsPrimitives'

interface Props {
  read: CueProfileRead
  onLearned: (profile: CueProfile) => void
  synced: Pick<SyncedDraft, 'cueLearnFromEdits'>
  patch: PatchSynced
}

export function useCueProfileRead(): [CueProfileRead | null, (profile: CueProfile) => void] {
  const [read, setRead] = useState<CueProfileRead | null>(null)
  const alive = useRef(true)
  const load = useCallback(() => {
    window.api.cueProfile().then(
      (next) => {
        if (alive.current) setRead(next)
      },
      () => {},
    )
  }, [])
  useEffect(() => {
    alive.current = true
    load()
    const off = window.api.onCueProfileChanged(load)
    return () => {
      alive.current = false
      off()
    }
  }, [load])
  const learned = useCallback((profile: CueProfile) => {
    if (alive.current) setRead((r) => (r ? { ...r, profile } : r))
  }, [])
  return [read, learned]
}

const BUTTON =
  'press inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY = `${BUTTON} border-transparent bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]`
const ICON_BUTTON =
  'press flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] text-fg hover:bg-[var(--color-line-strong)] disabled:cursor-not-allowed disabled:opacity-50'

const tenths = (share: number): number => Math.round(share * 10)

function countdownOf(flow: CueFlow | null): CueRule | null {
  return flow?.rules.find((r) => r.from === 'drop' && r.direction === 'back' && r.bars > 0) ?? null
}

function startOf(flow: CueFlow | null): boolean {
  return flow?.rules.some((r) => r.from === 'first-beat') ?? false
}

export function sameRules(a: CueFlow, b: CueFlow): boolean {
  return JSON.stringify(a.rules) === JSON.stringify(b.rules)
}

function Fact({
  testid,
  label,
  children,
  sub,
}: {
  testid: string
  label: string
  children: React.ReactNode
  sub?: string
}): React.JSX.Element {
  return (
    <div
      data-testid={testid}
      className="flex min-w-0 flex-col gap-1 bg-[var(--color-panel)] px-3 py-2.5"
    >
      <span className="text-[11px] text-fg-faint">{label}</span>
      <span className="text-sm text-fg">{children}</span>
      {sub && <span className="text-xs text-fg-dim">{sub}</span>}
    </div>
  )
}

export function CueProfileCard({ read, onLearned, synced, patch }: Props): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const [learning, setLearning] = useState(false)
  const [failed, setFailed] = useState(false)
  const [details, setDetails] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const count = (n: number) => formatCount(n, i18n.language)
  const profile: CueProfile | null = read.profile
  const learn = () => {
    setLearning(true)
    setFailed(false)
    window.api
      .learnCueProfile()
      .then(
        (learned) => onLearned(learned),
        (e: unknown) => {
          window.api.logError(
            `cue profile: learning failed (${e instanceof Error ? e.message : String(e)})`,
          )
          if (alive.current) setFailed(true)
        },
      )
      .finally(() => {
        if (alive.current) setLearning(false)
      })
  }
  const tracks = profile ? profile.sources.rekordbox + profile.sources.edits : 0
  const rekordboxTracks = profile ? profile.sources.rekordbox : read.marked
  const savedTracks = profile ? profile.sources.edits : read.edits.count
  const sourceParts = [
    rekordboxTracks > 0 && (
      <span key="rekordbox" data-testid="cue-profile-source-rekordbox">
        {'rekordbox '}
        <span className="tabular-nums">{count(rekordboxTracks)}</span>
      </span>
    ),
    savedTracks > 0 && (
      <span key="edits" data-testid="cue-profile-source-edits">
        {'Surco '}
        <span className="tabular-nums">{count(savedTracks)}</span>
      </span>
    ),
  ].filter(Boolean)
  const sources = sourceParts.flatMap((part, i) => (i === 0 ? [part] : [', ', part]))
  const nothing = read.marked === 0 && read.edits.count === 0
  const button = profile ? (
    <button
      type="button"
      data-testid="cue-profile-learn"
      disabled={learning || nothing}
      onClick={learn}
      aria-label={learning ? tr('settings.cueProfile.learning') : tr('settings.cueProfile.relearn')}
      className={ICON_BUTTON}
    >
      {learning ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      <Tooltip
        label={learning ? tr('settings.cueProfile.learning') : tr('settings.cueProfile.relearn')}
      />
    </button>
  ) : (
    <button
      type="button"
      data-testid="cue-profile-learn"
      disabled={learning || nothing}
      onClick={learn}
      className={PRIMARY}
    >
      {learning && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
      {learning ? tr('settings.cueProfile.learning') : tr('settings.cueProfile.learn')}
    </button>
  )
  const countdown = countdownOf(profile?.flow ?? null)
  const distances = countdown
    ? Array.from(
        { length: typeof countdown.repeat === 'number' ? countdown.repeat : 3 },
        (_, i) => ({
          bars: countdown.bars * (i + 1),
          color:
            'fixed' in countdown.color
              ? countdown.color.fixed
              : (countdown.color.each[i] ?? countdown.color.each[countdown.color.each.length - 1]),
        }),
      ).reverse()
    : []
  const learnedFlow = profile?.flow ?? null
  const check = profile?.check ?? null
  return (
    <section
      data-testid="cue-profile"
      className={`flex flex-col gap-2.5 ${
        profile
          ? 'border-t border-[var(--color-line)] pt-4'
          : 'rounded-xl border border-dashed border-[var(--color-line-strong)] p-4'
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-fg-muted">
            {profile ? tr('settings.cueProfile.title') : tr('settings.cueProfile.firstTitle')}
          </h3>
          {profile ? (
            <p data-testid="cue-profile-summary" className="mt-0.5 text-xs text-fg-dim">
              {tr('settings.cueProfile.summary', { count: tracks, tracks: count(tracks) })}
              {sources.length > 0 && ' · '}
              {sources}
            </p>
          ) : (
            <>
              <p className="mt-0.5 text-xs text-fg-dim">{tr('settings.cueProfile.firstHint')}</p>
              {sources.length > 0 && <p className="mt-1 text-xs text-fg-dim">{sources}</p>}
            </>
          )}
        </div>
        {button}
      </div>
      {nothing && !profile && (
        <SettingsHint data-testid="cue-profile-nothing">
          {tr('settings.cueProfile.nothing')}
        </SettingsHint>
      )}
      {failed && (
        <p data-testid="cue-profile-failed" className="text-xs text-warn">
          {tr('settings.cueFlows.learnFailed')}
        </p>
      )}
      {profile && (
        <button
          type="button"
          data-testid="cue-profile-details"
          aria-expanded={details}
          onClick={() => setDetails((v) => !v)}
          className="press inline-flex w-fit items-center gap-1 text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
        >
          {tr('settings.cueProfile.details')}
          <ChevronRight
            className={`h-3.5 w-3.5 transition-transform ${details ? 'rotate-90' : ''}`}
            aria-hidden="true"
          />
        </button>
      )}
      {profile && details && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-px overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-line)]">
          <Fact
            testid="cue-profile-auto"
            label={tr('editor.cues.auto.button')}
            sub={
              !check
                ? tr('settings.cueProfile.autoFewHint', { count: MIN_TASTE_TRACKS })
                : profile.taste
                  ? tr('settings.cueProfile.autoTuned', { before: tenths(check.before.found) })
                  : tr('settings.cueProfile.autoGeneral')
            }
          >
            {check
              ? tr('settings.cueProfile.autoFound', { found: tenths(check.after.found) })
              : tr('settings.cueProfile.autoFew')}
          </Fact>
          {countdown && (
            <Fact
              testid="cue-profile-countdown"
              label={tr('settings.cueProfile.countdown')}
              sub={
                profile.paired === null
                  ? undefined
                  : tr('settings.cueProfile.paired', {
                      share: new Intl.NumberFormat(i18n.language, {
                        maximumFractionDigits: 1,
                      }).format(profile.paired * 100),
                    })
              }
            >
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {distances.map((d) => (
                  <span
                    key={d.bars}
                    aria-hidden="true"
                    style={{ backgroundColor: hotCueColor(d.color) }}
                    className="inline-block h-2.5 w-2.5 rounded-[2px]"
                  />
                ))}
                {tr('settings.cueProfile.distances', {
                  count: countdown.bars,
                  bars: distances.map((d) => d.bars).join(' · '),
                })}
              </span>
            </Fact>
          )}
          {profile.start && profile.start.open > 0 && (
            <Fact
              testid="cue-profile-start"
              label={tr('settings.cueProfile.start')}
              sub={tr('settings.cueProfile.startShare', {
                with: count(profile.start.withStart),
                open: count(profile.start.open),
              })}
            >
              {startOf(learnedFlow)
                ? tr('settings.cueProfile.startYes')
                : tr('settings.cueProfile.startNo')}
            </Fact>
          )}
        </div>
      )}
      <div>
        <CheckboxRow
          testid="settings-cue-learn-from-edits"
          checked={synced.cueLearnFromEdits}
          onChange={(v) => patch('cueLearnFromEdits', v)}
          label={tr('settings.cueProfile.fromEdits')}
        />
        <SettingsHint className="mt-1 pl-7">{tr('settings.cueProfile.fromEditsHint')}</SettingsHint>
      </div>
    </section>
  )
}
