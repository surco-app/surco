import { AudioLines } from 'lucide-react'
import type React from 'react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OutputFormat, Settings } from '../../../shared/types'
import { buildOnboardingPatch } from '../lib/onboarding'
import { useFocusTrap } from './useFocusTrap'

const FORMATS: OutputFormat[] = ['aiff', 'mp3', 'wav', 'flac']
const STEPS = ['welcome', 'token', 'format', 'grouping', 'genre', 'required', 'spectrum'] as const

interface Props {
  settings: Settings
  onFinish: (patch: Partial<Settings>) => void
}

export function OnboardingWizard({ settings, onFinish }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [step, setStep] = useState(0)
  const [token, setToken] = useState(settings.discogsToken)
  const [outputFormat, setOutputFormat] = useState(settings.outputFormat)
  const [grouping, setGrouping] = useState(settings.groupingPresets.join(', '))
  const [genre, setGenre] = useState(settings.genrePresets.join(', '))
  const [showSpectrum, setShowSpectrum] = useState(settings.showSpectrum)
  const [autoMatch, setAutoMatch] = useState(settings.autoMatch)
  const [requiredFields, setRequiredFields] = useState(settings.requiredFields)
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef)

  const isLast = step === STEPS.length - 1

  function finish(): void {
    onFinish(
      buildOnboardingPatch({
        discogsToken: token,
        outputFormat,
        grouping,
        genre,
        showSpectrum,
        autoMatch,
        requiredFields,
      }),
    )
  }

  function toggleRequired(key: string): void {
    setRequiredFields((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    )
  }

  return (
    <div className="animate-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-step-title"
        className="animate-pop w-[560px] rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-panel)] p-6"
      >
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault()
            if (isLast) finish()
            else setStep((s) => s + 1)
          }}
        >
          <div className="min-h-[280px]">
            {STEPS[step] === 'welcome' && (
              <div className="flex h-[280px] flex-col items-center justify-center text-center">
                <AudioLines
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="mb-5 h-12 w-12 text-[var(--color-accent)]"
                />
                <h2 id="onboarding-step-title" className="text-lg font-semibold text-balance">
                  {tr('onboarding.welcomeTitle')}
                </h2>
                <p className="mt-2 max-w-sm text-sm text-pretty text-fg-dim">
                  {tr('onboarding.welcomeBody')}
                </p>
              </div>
            )}

            {STEPS[step] === 'token' && (
              <>
                <h2 id="onboarding-step-title" className="mb-1 text-lg font-semibold">
                  {tr('settings.discogsToken')}
                </h2>
                <p className="mb-4 text-sm text-fg-dim">{tr('onboarding.tokenBody')}</p>
                <input
                  data-testid="onboarding-token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={tr('settings.tokenPlaceholder')}
                  className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
                />
                <p className="mt-1.5 text-xs text-fg-dim">
                  {tr('settings.tokenHelp')}{' '}
                  <a
                    href="https://www.discogs.com/settings/developers"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--color-accent)] hover:underline"
                  >
                    discogs.com/settings/developers
                  </a>
                </p>
                <label
                  className={`mt-5 flex items-center gap-3 border-t border-[var(--color-line)] pt-4 ${
                    token.trim() ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                  }`}
                >
                  <input
                    data-testid="onboarding-auto-match"
                    type="checkbox"
                    checked={autoMatch && token.trim() !== ''}
                    disabled={token.trim() === ''}
                    onChange={(e) => setAutoMatch(e.target.checked)}
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                  <span className="text-sm">
                    {tr('settings.autoMatch')}
                    <span className="mt-0.5 block text-xs text-fg-dim">
                      {token.trim()
                        ? tr('onboarding.autoMatchBody')
                        : tr('onboarding.autoMatchNeedsToken')}
                    </span>
                  </span>
                </label>
              </>
            )}

            {STEPS[step] === 'format' && (
              <>
                <h2 id="onboarding-step-title" className="mb-1 text-lg font-semibold">
                  {tr('settings.outputFormat')}
                </h2>
                <p className="mb-4 text-sm text-fg-dim">{tr('onboarding.formatBody')}</p>
                <div className="inline-flex gap-1 rounded-lg bg-[var(--color-field)] p-1">
                  {FORMATS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      data-testid={`onboarding-format-${id}`}
                      aria-pressed={outputFormat === id}
                      onClick={() => setOutputFormat(id)}
                      className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
                        outputFormat === id
                          ? 'bg-[var(--color-panel-2)] text-fg'
                          : 'text-fg-muted hover:text-fg'
                      }`}
                    >
                      {tr(`settings.formats.${id}`)}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-xs text-fg-dim">{tr('settings.outputFormatHint')}</p>
              </>
            )}

            {STEPS[step] === 'grouping' && (
              <>
                <h2 id="onboarding-step-title" className="mb-1 text-lg font-semibold">
                  {tr('settings.grouping')}
                </h2>
                <p className="mb-4 text-sm text-fg-dim">{tr('onboarding.groupingBody')}</p>
                <input
                  data-testid="onboarding-grouping"
                  value={grouping}
                  onChange={(e) => setGrouping(e.target.value)}
                  placeholder="Bases, Cantaditas"
                  className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
                />
                <p className="mt-1.5 text-xs text-fg-dim">{tr('settings.groupingHint')}</p>
              </>
            )}

            {STEPS[step] === 'genre' && (
              <>
                <h2 id="onboarding-step-title" className="mb-1 text-lg font-semibold">
                  {tr('settings.genre')}
                </h2>
                <p className="mb-4 text-sm text-fg-dim">{tr('onboarding.genreBody')}</p>
                <input
                  data-testid="onboarding-genre"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  placeholder="Hard Dance, Techno"
                  className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
                />
                <p className="mt-1.5 text-xs text-fg-dim">{tr('settings.genreHint')}</p>
              </>
            )}

            {STEPS[step] === 'required' && (
              <>
                <h2 id="onboarding-step-title" className="mb-1 text-lg font-semibold">
                  {tr('settings.required')}
                </h2>
                <p className="mb-4 text-sm text-fg-dim">{tr('onboarding.requiredBody')}</p>
                <div className="flex flex-wrap gap-2">
                  {settings.visibleFields.map((key) => {
                    const on = requiredFields.includes(key)
                    return (
                      <button
                        key={key}
                        type="button"
                        data-testid={`onboarding-required-${key}`}
                        aria-pressed={on}
                        onClick={() => toggleRequired(key)}
                        className={`press rounded-full border px-3 py-1 text-sm transition-colors ${
                          on
                            ? 'border-transparent bg-[var(--color-accent)] text-white'
                            : 'border-[var(--color-line-strong)] text-fg-muted hover:bg-[var(--color-panel-2)]'
                        }`}
                      >
                        {tr(`fields.${key}`)}
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {STEPS[step] === 'spectrum' && (
              <>
                <h2 id="onboarding-step-title" className="mb-1 text-lg font-semibold">
                  {tr('settings.showSpectrum')}
                </h2>
                <p className="mb-4 text-sm text-fg-dim">{tr('onboarding.spectrumBody')}</p>
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    data-testid="onboarding-spectrum"
                    type="checkbox"
                    checked={showSpectrum}
                    onChange={(e) => setShowSpectrum(e.target.checked)}
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                  <span className="text-sm">{tr('settings.showSpectrum')}</span>
                </label>
              </>
            )}
          </div>

          <div className="mt-6 flex items-center justify-between border-t border-[var(--color-line)] pt-4">
            <button
              type="button"
              data-testid="onboarding-skip"
              onClick={() => onFinish(buildOnboardingPatch(null))}
              className="press rounded-lg px-3 py-2 text-sm text-fg-muted hover:text-fg"
            >
              {tr('onboarding.skip')}
            </button>
            <div className="flex items-center gap-3">
              <span className="text-xs text-fg-faint">
                {tr('onboarding.step', { current: step + 1, total: STEPS.length })}
              </span>
              {step > 0 && (
                <button
                  type="button"
                  data-testid="onboarding-back"
                  onClick={() => setStep((s) => s - 1)}
                  className="press rounded-lg px-4 py-2 text-sm text-fg-muted hover:text-fg"
                >
                  {tr('onboarding.back')}
                </button>
              )}
              <button
                type="submit"
                data-testid="onboarding-next"
                className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
              >
                {isLast ? tr('onboarding.finish') : tr('onboarding.next')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
