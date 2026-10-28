import { Loader2 } from 'lucide-react'
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
import { CheckboxRow } from './CheckboxRow'
import { SettingsHint } from './SettingsPrimitives'

interface Props {
  synced: Pick<SyncedDraft, 'cueFlows' | 'activeCueFlow' | 'cueLearnFromEdits'>
  patch: PatchSynced
  onAdopt: (id: string) => void
}

const BUTTON =
  'press inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY = `${BUTTON} border-transparent bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]`
const SECONDARY = `${BUTTON} border-[var(--color-line-strong)] bg-[var(--color-panel-2)] text-fg hover:bg-[var(--color-hover)]`
const CHIP =
  'rounded-full border border-[var(--color-line-strong)] bg-[var(--color-field)] px-2.5 py-0.5 text-xs text-fg-dim'

const tenths = (share: number): number => Math.round(share * 10)

function countdownOf(flow: CueFlow | null): CueRule | null {
  return flow?.rules.find((r) => r.from === 'drop' && r.direction === 'back' && r.bars > 0) ?? null
}

function startOf(flow: CueFlow | null): boolean {
  return flow?.rules.some((r) => r.from === 'first-beat') ?? false
}

function sameRules(a: CueFlow, b: CueFlow): boolean {
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

export function CueProfileCard({ synced, patch, onAdopt }: Props): React.JSX.Element | null {
  const { t: tr, i18n } = useTranslation()
  const [read, setRead] = useState<CueProfileRead | null>(null)
  const [learning, setLearning] = useState(false)
  const [failed, setFailed] = useState(false)
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
  if (!read) return null
  const count = (n: number) => formatCount(n, i18n.language)
  const profile: CueProfile | null = read.profile
  const learn = () => {
    setLearning(true)
    setFailed(false)
    window.api
      .learnCueProfile()
      .then(
        (learned) => {
          if (alive.current) setRead((r) => (r ? { ...r, profile: learned } : r))
        },
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
  const adopt = (flow: CueFlow) => {
    const made: CueFlow = {
      ...flow,
      id: crypto.randomUUID(),
      name: tr('settings.cueFlows.learnedName'),
    }
    patch('cueFlows', [...synced.cueFlows, made])
    patch('activeCueFlow', made.id)
    onAdopt(made.id)
  }
  const sources = (
    <div className="flex flex-wrap gap-2">
      {read.marked > 0 && (
        <span data-testid="cue-profile-source-rekordbox" className={CHIP}>
          {'rekordbox '}
          <b className="font-semibold text-fg tabular-nums">{count(read.marked)}</b>{' '}
          {tr('settings.cueProfile.tracks', { count: read.marked })}
        </span>
      )}
      {read.edits.count > 0 && (
        <span data-testid="cue-profile-source-edits" className={CHIP}>
          {`${tr('settings.cueProfile.saved')} `}
          <b className="font-semibold text-fg tabular-nums">{count(read.edits.count)}</b>{' '}
          {tr('settings.cueProfile.tracks', { count: read.edits.count })}
        </span>
      )}
    </div>
  )
  const nothing = read.marked === 0 && read.edits.count === 0
  const button = (
    <button
      type="button"
      data-testid="cue-profile-learn"
      disabled={learning || nothing}
      onClick={learn}
      className={profile ? SECONDARY : PRIMARY}
    >
      {learning && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
      {learning
        ? tr('settings.cueProfile.learning')
        : profile
          ? tr('settings.cueProfile.relearn')
          : tr('settings.cueProfile.learn')}
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
  const offered = learnedFlow && !synced.cueFlows.some((f) => sameRules(f, learnedFlow))
  const check = profile?.check ?? null
  const tracks = check?.tracks ?? profile?.sources.rekordbox ?? 0
  return (
    <section
      data-testid="cue-profile"
      className={`flex flex-col gap-3 rounded-xl border p-4 ${
        profile
          ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent)]/[0.06]'
          : 'border-dashed border-[var(--color-line-strong)]'
      }`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-fg">
            {profile ? tr('settings.cueProfile.title') : tr('settings.cueProfile.firstTitle')}
          </h3>
          {profile ? (
            <p data-testid="cue-profile-summary" className="mt-0.5 text-xs text-fg-dim">
              {tr('settings.cueProfile.summary', { count: tracks, tracks: count(tracks) })}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-fg-dim">{tr('settings.cueProfile.firstHint')}</p>
          )}
        </div>
        {button}
      </div>
      {sources}
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
        <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-px overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-line)]">
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
      {offered && learnedFlow && (
        <div>
          <button
            type="button"
            data-testid="cue-profile-use-flow"
            onClick={() => adopt(learnedFlow)}
            className={SECONDARY}
          >
            {tr('settings.cueProfile.useFlow')}
          </button>
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
