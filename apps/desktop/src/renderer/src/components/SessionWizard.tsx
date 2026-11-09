import { X } from 'lucide-react'
import type React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DjProgram } from '../../../shared/djProgram'
import type { PlaylistRole, SessionAnswers } from '../../../shared/sessionTypes'
import type { SourceNode } from '../../../shared/types'
import { ModalShell } from './ModalShell'
import { flattenPlaylists } from './SourceTree'
import { DurationStep, isPresetMinutes, SourcesStep, wholeMinutes } from './SessionWizardSteps'

const STEPS = ['duration', 'sources', 'fresh', 'character'] as const

export function SessionWizard({
  tree,
  roles: savedRoles,
  initial,
  onRole,
  onClose,
}: {
  program: DjProgram
  tree: readonly SourceNode[]
  roles: Readonly<Record<string, PlaylistRole>>
  initial: SessionAnswers
  onRole: (id: string, role: PlaylistRole | null) => void
  onClose: () => void
  onBuild: (answers: SessionAnswers) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [step, setStep] = useState(0)
  const [minutes, setMinutes] = useState(initial.minutes)
  const [custom, setCustom] = useState<string | null>(
    isPresetMinutes(initial.minutes) ? null : String(initial.minutes),
  )
  const [roles, setRoles] = useState<Record<string, PlaylistRole>>({ ...savedRoles })
  const inTree = useMemo(() => new Set(flattenPlaylists([...tree]).map((p) => p.node.id)), [tree])
  const [sources, setSources] = useState<string[]>(() => {
    const wanted = initial.sources.length > 0 ? initial.sources : Object.keys(savedRoles)
    return wanted.filter((id) => inTree.has(id) && savedRoles[id] !== undefined)
  })
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

  const minutesValid = custom === null || wholeMinutes(custom) !== null
  const current = STEPS[step]
  const last = step === STEPS.length - 1
  const blocked =
    last ||
    (current === 'duration' && !minutesValid) ||
    (current === 'sources' && sources.length === 0)

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
        {tr(`sessions.wizard.${current === 'duration' ? 'duration' : 'sources'}.heading`)}
      </h3>
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
        <button
          type="button"
          data-testid="session-wizard-next"
          disabled={blocked}
          onClick={() => setStep((s) => s + 1)}
          className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
        >
          {tr('sessions.wizard.next')}
        </button>
      </div>
    </ModalShell>
  )
}
