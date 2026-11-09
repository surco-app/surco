import { X } from 'lucide-react'
import type React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { camelotOf } from '../../../shared/camelot'
import type { PlaylistRole, SessionAnswers } from '../../../shared/sessionTypes'
import type { SourceNode, SourcePlaylistEntry } from '../../../shared/types'
import type { BuildResult } from '../hooks/useSessionRun'
import type { SessionRows } from '../hooks/useSessionRows'
import { ModalShell } from './ModalShell'
import {
  CharacterStep,
  DurationStep,
  FreshStep,
  isPresetMinutes,
  SourcesStep,
  wholeMinutes,
} from './SessionWizardSteps'
import { flattenPlaylists } from './SourceTree'

const STEPS = ['duration', 'sources', 'fresh', 'character'] as const

const PROBLEM_TEXT: Record<Exclude<BuildResult, 'built'>, string> = {
  empty: 'sessions.wizard.empty',
  closed: 'sessions.closed',
  refused: 'sessions.wizard.refused',
}

type Options = Pick<
  SessionAnswers,
  'alternate' | 'preferCombos' | 'tasteWeight' | 'surprise' | 'harmony'
>

export function SessionWizard({
  tree,
  roles: savedRoles,
  initial,
  rows,
  onRole,
  onClose,
  onBuild,
}: {
  tree: readonly SourceNode[]
  roles: Readonly<Record<string, PlaylistRole>>
  initial: SessionAnswers
  rows: SessionRows
  onRole: (id: string, role: PlaylistRole | null) => void
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
  const names = useMemo(
    () => new Map(flattenPlaylists([...tree]).map((p) => [p.node.id, p.node.name])),
    [tree],
  )
  const [sources, setSources] = useState<string[]>(() => {
    const wanted = initial.sources.length > 0 ? initial.sources : Object.keys(savedRoles)
    return wanted.filter((id) => names.has(id) && savedRoles[id] !== undefined)
  })
  const [fresh, setFresh] = useState<string[]>(() => initial.fresh.filter((id) => names.has(id)))
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
    onRole(id, role)
  }

  const current = STEPS[step]
  const last = step === STEPS.length - 1
  const minutesValid = custom === null || wholeMinutes(custom) !== null
  const blocked =
    reading ||
    (current === 'duration' && !minutesValid) ||
    (current === 'sources' && sources.length === 0)

  const hasKeys = [...sources, ...fresh].some((id) =>
    (loaded.get(id) ?? []).some((entry) => camelotOf(entry.meta.key) !== null),
  )
  const unreadable = [...sources, ...fresh]
    .filter((id) => rows.failed.includes(id))
    .map((id) => names.get(id) ?? id)

  const advance = async (): Promise<void> => {
    const ids = current === 'sources' ? sources : current === 'fresh' ? fresh : []
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
    for (const id of [...sources, ...fresh]) {
      const role = roles[id]
      if (role) chosenRoles[id] = role
    }
    const result = await onBuild(
      {
        minutes,
        playMinutes,
        sources,
        fresh,
        freshShare: fresh.length > 0 ? freshShare : 0,
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
          tree={tree}
          roles={roles}
          sources={sources}
          onPick={pick}
          onDrop={(id) => setSources((prev) => prev.filter((other) => other !== id))}
        />
      )}
      {current === 'fresh' && (
        <FreshStep
          tree={tree}
          fresh={fresh}
          share={freshShare}
          onAdd={(id) => setFresh((prev) => (prev.includes(id) ? prev : [...prev, id]))}
          onDrop={(id) => setFresh((prev) => prev.filter((other) => other !== id))}
          onShare={setFreshShare}
        />
      )}
      {current === 'character' && (
        <CharacterStep
          options={options}
          hasKeys={hasKeys}
          playMinutes={playMinutes}
          onPlayMinutes={setPlayMinutes}
          onChange={(patch) => setOptions((prev) => ({ ...prev, ...patch }))}
        />
      )}
      {problem && (
        <p data-testid={`session-wizard-${problem}`} className="mt-3 text-xs text-warn">
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
            onClick={build}
            className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
          >
            {tr('sessions.wizard.build')}
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
