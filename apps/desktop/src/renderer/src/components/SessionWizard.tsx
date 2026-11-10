import { X } from 'lucide-react'
import type { TFunction } from 'i18next'
import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { camelotOf } from '../../../shared/camelot'
import type { PlaylistRole, SessionAnswers } from '../../../shared/sessionTypes'
import type { SourceNode, SourcePlaylistEntry } from '../../../shared/types'
import type { BuildResult } from '../hooks/useSessionRun'
import type { SessionRows } from '../hooks/useSessionRows'
import { toCandidates } from '../lib/sessionCandidates'
import { withoutSeparators } from '../lib/sessionTree'
import { ModalShell } from './ModalShell'
import {
  CharacterStep,
  DurationStep,
  isPresetMinutes,
  SourcesStep,
  wholeMinutes,
} from './SessionWizardSteps'
import { flattenPlaylists } from './SourceTree'

const STEPS = ['duration', 'sources', 'character'] as const

const PROBLEM_TEXT: Record<Exclude<BuildResult, 'built'>, string> = {
  empty: 'sessions.wizard.empty',
  closed: 'sessions.closed',
  refused: 'sessions.wizard.refused',
}

type Options = Pick<
  SessionAnswers,
  'alternate' | 'preferCombos' | 'tasteWeight' | 'surprise' | 'harmony'
>

export interface SessionDestination {
  kind: 'new' | 'fill' | 'replace'
  name: string
  where: string | null
}

function destinationText(destination: SessionDestination, tr: TFunction): string {
  if (destination.kind === 'fill')
    return tr('sessions.wizard.destinationFill', { name: destination.name })
  if (destination.kind === 'replace')
    return tr('sessions.wizard.destinationReplace', { name: destination.name })
  return destination.where
    ? tr('sessions.wizard.destinationNewIn', { name: destination.name, where: destination.where })
    : tr('sessions.wizard.destinationNew', { name: destination.name })
}

export function SessionWizard({
  tree,
  roles: savedRoles = {},
  initial,
  rows,
  destination,
  onClose,
  onBuild,
}: {
  tree: readonly SourceNode[]
  roles?: Readonly<Record<string, PlaylistRole>>
  initial: SessionAnswers
  rows: SessionRows
  destination: SessionDestination
  onClose: () => void
  onBuild: (
    answers: SessionAnswers,
    roles: Readonly<Record<string, PlaylistRole>>,
  ) => Promise<BuildResult>
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [step, setStep] = useState(0)
  const [minutes, setMinutes] = useState(initial.minutes)
  const [custom, setCustom] = useState<string | null>(
    isPresetMinutes(initial.minutes) ? null : String(initial.minutes),
  )
  const [roles, setRoles] = useState<Record<string, PlaylistRole>>({ ...savedRoles })
  const usable = useMemo(() => withoutSeparators(tree), [tree])
  const names = useMemo(
    () => new Map(flattenPlaylists([...usable]).map((p) => [p.node.id, p.node.name])),
    [usable],
  )
  const [onlyChosen, setOnlyChosen] = useState(false)
  const [sources, setSources] = useState<string[]>(() => {
    return initial.sources.filter((id) => names.has(id) && savedRoles[id] !== undefined)
  })
  const [freshShare, setFreshShare] = useState(initial.freshShare)
  const [playMinutes, setPlayMinutes] = useState(initial.playMinutes)
  const [options, setOptions] = useState<Options>({
    alternate: initial.alternate,
    preferCombos: initial.preferCombos,
    tasteWeight: initial.tasteWeight,
    surprise: initial.surprise,
    harmony: initial.harmony,
  })
  const [loaded, setLoaded] = useState<ReadonlyMap<string, readonly SourcePlaylistEntry[]>>(
    new Map(),
  )
  const [reading, setReading] = useState(false)
  const [building, setBuilding] = useState(false)
  const [problem, setProblem] = useState<Exclude<BuildResult, 'built'> | null>(null)
  const focusHeading = useCallback((el: HTMLHeadingElement | null) => el?.focus(), [])

  const pick = (id: string, role: PlaylistRole | null): void => {
    setRoles((prev) => {
      const next = { ...prev }
      if (role) next[id] = role
      else delete next[id]
      return next
    })
    setSources((prev) =>
      role ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((other) => other !== id),
    )
  }

  const pickMany = (picks: Readonly<Record<string, PlaylistRole | null>>): void => {
    setRoles((prev) => {
      const next = { ...prev }
      for (const [id, role] of Object.entries(picks)) {
        if (role) next[id] = role
        else delete next[id]
      }
      return next
    })
    setSources((prev) => {
      const kept = prev.filter((id) => picks[id] !== null)
      const added = Object.entries(picks)
        .filter(([id, role]) => role !== null && !kept.includes(id))
        .map(([id]) => id)
      return [...kept, ...added]
    })
  }

  const current = STEPS[step]
  const last = step === STEPS.length - 1
  const minutesValid = custom === null || wholeMinutes(custom) !== null
  const blocked =
    reading ||
    (current === 'duration' && !minutesValid) ||
    (current === 'sources' && sources.length === 0)

  const hasKeys = sources.some((id) =>
    (loaded.get(id) ?? []).some((entry) => camelotOf(entry.meta.key) !== null),
  )
  const hasNew = useMemo(
    () =>
      toCandidates(
        sources.map((id) => ({ role: roles[id] ?? 'any', entries: loaded.get(id) ?? [] })),
      ).some((track) => track.fresh),
    [sources, roles, loaded],
  )
  const unreadable = sources
    .filter((id) => rows.failed.includes(id))
    .map((id) => names.get(id) ?? id)

  const advance = async (): Promise<void> => {
    const ids = current === 'sources' ? sources : []
    if (ids.length > 0) {
      setReading(true)
      const got = await rows.load(ids)
      setLoaded((prev) => new Map([...prev, ...got]))
      setReading(false)
    }
    setStep((s) => s + 1)
  }

  const build = async (): Promise<void> => {
    setBuilding(true)
    setProblem(null)
    const chosenRoles: Record<string, PlaylistRole> = {}
    for (const id of sources) {
      const role = roles[id]
      if (role) chosenRoles[id] = role
    }
    const result = await onBuild(
      {
        minutes,
        playMinutes,
        sources,
        freshShare,
        preferCombos: options.preferCombos,
        harmony: hasKeys ? options.harmony : 'free',
        tasteWeight: options.tasteWeight,
        alternate: options.alternate,
        surprise: options.surprise,
      },
      chosenRoles,
    )
    setBuilding(false)
    setProblem(result === 'built' ? null : result)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      if (last) {
        if (!building) void build()
      } else if (!blocked) void advance()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <ModalShell
      onClose={onClose}
      backdropTestId="session-wizard-backdrop"
      dialogTestId="session-wizard-dialog"
      labelledBy="session-wizard-title"
      className="w-[640px] max-w-[calc(100vw-32px)] rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
    >
      <div className="-mx-6 -mt-6 mb-4 border-b border-[var(--color-line)] px-6 pt-5 pb-3">
        <div className="flex items-center justify-between">
          <h2 id="session-wizard-title" className="text-base font-semibold">
            {tr('sessions.wizard.title')}
          </h2>
          <button
            type="button"
            data-testid="session-wizard-close"
            onClick={onClose}
            aria-label={tr('common.close')}
            className="press flex h-7 w-7 items-center justify-center rounded-lg text-fg-muted hover:bg-[var(--color-hover)] hover:text-fg"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <ol
          aria-label={tr('sessions.wizard.step', { current: step + 1, total: STEPS.length })}
          className="mt-2 flex items-center gap-3 text-[11px] text-fg-faint"
        >
          {STEPS.map((id, i) => (
            <li
              key={id}
              aria-current={i === step ? 'step' : undefined}
              className={`flex items-center gap-1.5 ${i === step ? 'text-fg' : ''}`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  i === step
                    ? 'bg-[var(--color-accent)]'
                    : i < step
                      ? 'bg-[var(--color-accent)] opacity-50'
                      : 'bg-[var(--color-line-strong)]'
                }`}
              />
              {tr(`sessions.wizard.steps.${id}`)}
            </li>
          ))}
        </ol>
      </div>
      <h3
        key={current}
        ref={focusHeading}
        id="session-wizard-step-title"
        data-testid="session-wizard-step-title"
        tabIndex={-1}
        className="mb-3 text-sm font-semibold outline-none"
      >
        {tr(`sessions.wizard.${current}.heading`)}
      </h3>
      {step >= 2 && unreadable.length > 0 && (
        <p data-testid="session-wizard-load-failed" className="mb-3 text-xs text-warn">
          {tr('sessions.wizard.loadFailed', { names: unreadable.join(', ') })}
        </p>
      )}
      <div className="min-h-[480px]">
        {current === 'duration' && (
          <DurationStep
            minutes={minutes}
            custom={custom}
            onPreset={(value) => {
              setMinutes(value)
              setCustom(null)
            }}
            onCustomOpen={() => setCustom((text) => text ?? String(minutes))}
            onCustomText={(text) => {
              setCustom(text)
              const value = wholeMinutes(text)
              if (value !== null) setMinutes(value)
            }}
          />
        )}
        {current === 'sources' && (
          <SourcesStep
            tree={usable}
            roles={roles}
            sources={sources}
            onPick={pick}
            onPickMany={pickMany}
            only={onlyChosen}
            onOnly={setOnlyChosen}
            minutes={minutes}
            playMinutes={playMinutes}
          />
        )}
        {current === 'character' && (
          <CharacterStep
            options={options}
            hasKeys={hasKeys}
            playMinutes={playMinutes}
            onPlayMinutes={setPlayMinutes}
            hasNew={hasNew}
            hasMixed={sources.some((id) => roles[id] === 'any')}
            freshShare={freshShare}
            onFreshShare={setFreshShare}
            onChange={(patch) => setOptions((prev) => ({ ...prev, ...patch }))}
          />
        )}
        {last && (
          <p data-testid="session-wizard-destination" className="mt-3 text-xs text-fg-dim">
            {destinationText(destination, tr)}
          </p>
        )}
      </div>
      {problem && (
        <p
          data-testid={`session-wizard-${problem}`}
          role="status"
          className="mt-3 text-xs text-warn"
        >
          {tr(PROBLEM_TEXT[problem])}
        </p>
      )}
      <div className="mt-5 flex items-center justify-end gap-2">
        {step > 0 && (
          <button
            type="button"
            data-testid="session-wizard-back"
            onClick={() => setStep((s) => s - 1)}
            className="press rounded-lg border border-[var(--color-line-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-hover)]"
          >
            {tr('sessions.wizard.back')}
          </button>
        )}
        {last ? (
          <button
            type="button"
            data-testid="session-wizard-build"
            disabled={building}
            aria-busy={building}
            onClick={build}
            className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
          >
            {tr(building ? 'sessions.wizard.building' : 'sessions.wizard.build')}
          </button>
        ) : (
          <button
            type="button"
            data-testid="session-wizard-next"
            disabled={blocked}
            onClick={advance}
            className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            {reading ? tr('sessions.wizard.loading') : tr('sessions.wizard.next')}
          </button>
        )}
      </div>
    </ModalShell>
  )
}
