import { AudioLines } from 'lucide-react'
import type React from 'react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { autoMatchAvailable } from '../../../shared/autoMatch'
import type { SearchProviderId, Settings } from '../../../shared/types'
import { DESTINATIONS, fromDestination, toDestination } from '../lib/destination'
import { type AudioIntent, buildOnboardingPatch } from '../lib/onboarding'
import { isMacOS } from '../lib/platform'
import { formatKHz } from '../lib/quality'
import { DestinationPicker } from './DestinationPicker'
import { FormatSettingControl } from './FormatSettingControl'
import { useFocusTrap } from './useFocusTrap'

const SEARCH_PROVIDERS: SearchProviderId[] = ['discogs', 'bandcamp']
// The optional audio intents, in the order they're offered. Correct metadata is the
// product's core, so it's shown as an always-on row above these rather than a choice.
const AUDIO_INTENTS: AudioIntent[] = ['restore', 'level', 'quality']
// Four steps only: what shapes the first import (search sources + auto-match, output
// format + destination) plus the workflow question that tailors the editor to the DJ.
// Naming, grouping/genre presets and the fields editor are power-user tuning that lives
// in Settings — every extra question here delays the first drop of files.
const STEPS = ['welcome', 'search', 'format', 'audio'] as const

interface Props {
  settings: Settings
  onFinish: (patch: Partial<Settings>) => void
}

export function OnboardingWizard({ settings, onFinish }: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  // Read at render (not module load) like the rest of the tree; Apple Music is the one
  // destination that only exists on macOS.
  const isMac = isMacOS()
  const [step, setStep] = useState(0)
  const [token, setToken] = useState(settings.discogsToken)
  const [searchProviders, setSearchProviders] = useState(settings.searchProviders)
  const [outputFormat, setOutputFormat] = useState(settings.outputFormat)
  const [outputDir, setOutputDir] = useState(settings.outputDir)
  // Seed from the one intent that maps to an existing default (the spectrum). The rest
  // start unpicked so a first-run editor is minimal until the DJ opts in.
  const [audioIntents, setAudioIntents] = useState<AudioIntent[]>(
    settings.showSpectrum ? ['quality'] : [],
  )
  const [autoMatch, setAutoMatch] = useState(settings.autoMatch)
  const [addToAppleMusic, setAddToAppleMusic] = useState(settings.addToAppleMusic)
  const [keepOutputCopy, setKeepOutputCopy] = useState(settings.keepOutputCopy)
  const [overwriteOriginal, setOverwriteOriginal] = useState(settings.overwriteOriginal)
  const [convertBesideOriginal, setConvertBesideOriginal] = useState(settings.convertBesideOriginal)
  const [addToEngineDj, setAddToEngineDj] = useState(settings.addToEngineDj)
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef)

  const isLast = step === STEPS.length - 1
  const discogsOn = searchProviders.includes('discogs')
  // Auto-match needs a source, plus a Discogs token whenever Discogs is one of them.
  const autoReady = autoMatchAvailable({ searchProviders, discogsToken: token })

  function finish(): void {
    onFinish(
      buildOnboardingPatch({
        discogsToken: token,
        searchProviders,
        outputFormat,
        outputDir,
        audioIntents,
        autoMatch,
        addToAppleMusic,
        keepOutputCopy,
        overwriteOriginal,
        addToEngineDj,
        convertBesideOriginal,
      }),
    )
  }

  // FLAC can't go to Apple Music, so the destination pins to the output folder while
  // it's the format. chooseDestination maps the single radio back onto the stored booleans.
  const destination = toDestination(
    addToAppleMusic,
    outputFormat === 'flac',
    overwriteOriginal,
    addToEngineDj,
    convertBesideOriginal,
  )
  async function changeDir(): Promise<void> {
    const dir = await window.api.pickOutputDir()
    if (dir) setOutputDir(dir)
  }
  function chooseDestination(d: (typeof DESTINATIONS)[number]): void {
    const next = fromDestination(d)
    setAddToAppleMusic(next.addToAppleMusic)
    setKeepOutputCopy(next.keepOutputCopy)
    setOverwriteOriginal(next.overwriteOriginal)
    setConvertBesideOriginal(next.convertBesideOriginal)
    setAddToEngineDj(next.addToEngineDj)
  }
  function toggleIntent(intent: AudioIntent, on: boolean): void {
    setAudioIntents((prev) => (on ? [...prev, intent] : prev.filter((i) => i !== intent)))
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

            {STEPS[step] === 'search' && (
              <>
                <h2 id="onboarding-step-title" className="mb-1 text-lg font-semibold">
                  {tr('settings.searchProviders')}
                </h2>
                <p className="mb-4 text-sm text-fg-dim">{tr('settings.searchProvidersHint')}</p>
                <div
                  className="flex flex-wrap gap-x-5 gap-y-2"
                  data-testid="onboarding-search-providers"
                >
                  {SEARCH_PROVIDERS.map((p) => (
                    <label key={p} className="flex cursor-pointer items-center gap-2">
                      <input
                        data-testid={`onboarding-provider-${p}`}
                        type="checkbox"
                        checked={searchProviders.includes(p)}
                        onChange={(e) =>
                          setSearchProviders((prev) =>
                            e.target.checked ? [...prev, p] : prev.filter((x) => x !== p),
                          )
                        }
                        className="h-4 w-4 accent-[var(--color-accent)]"
                      />
                      <span className="text-sm">{tr(`settings.provider.${p}`)}</span>
                    </label>
                  ))}
                </div>

                {discogsOn && (
                  <div className="mt-5 border-t border-[var(--color-line)] pt-4">
                    <label
                      htmlFor="onboarding-token"
                      className="mb-1.5 block text-sm font-medium text-fg-muted"
                    >
                      {tr('settings.discogsToken')}
                    </label>
                    <input
                      id="onboarding-token"
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
                  </div>
                )}

                <label
                  className={`mt-5 flex items-center gap-3 border-t border-[var(--color-line)] pt-4 ${
                    autoReady ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                  }`}
                >
                  <input
                    data-testid="onboarding-auto-match"
                    type="checkbox"
                    checked={autoMatch && autoReady}
                    disabled={!autoReady}
                    onChange={(e) => setAutoMatch(e.target.checked)}
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                  <span className="text-sm">
                    {tr('settings.autoMatch')}
                    <span className="mt-0.5 block text-xs text-fg-dim">
                      {autoReady
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
                <FormatSettingControl
                  value={outputFormat}
                  onChange={setOutputFormat}
                  testidPrefix="onboarding-format"
                />
                <p className="mt-3 text-xs text-fg-dim">{tr('settings.outputFormatHint')}</p>

                <div className="mt-5 border-t border-[var(--color-line)] pt-4">
                  <span className="mb-1.5 block text-sm font-medium text-fg-muted">
                    {tr('settings.destination')}
                  </span>
                  <DestinationPicker
                    destinations={DESTINATIONS.filter((d) => isMac || d !== 'appleMusic')}
                    value={destination}
                    onChange={chooseDestination}
                    flacOnly={outputFormat === 'flac'}
                    testidPrefix="onboarding-destination"
                    radioName="onboarding-destination"
                    details={{
                      // WHERE the files land is the first thing a new user looks for
                      // after converting — show it (and let them change it) right
                      // under the choice it applies to, exactly like Settings.
                      folder: (
                        <div className="flex gap-2">
                          <input
                            data-testid="onboarding-output-dir"
                            aria-label={tr('settings.outputDir')}
                            value={outputDir}
                            readOnly
                            className="min-w-0 flex-1 truncate rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm text-fg-muted"
                          />
                          <button
                            type="button"
                            data-testid="onboarding-output-change"
                            onClick={() => void changeDir()}
                            className="press rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3 py-2 text-sm hover:bg-[var(--color-line-strong)]"
                          >
                            {tr('common.change')}
                          </button>
                        </div>
                      ),
                    }}
                  />
                  {isMac && outputFormat === 'flac' && (
                    <p className="mt-1.5 text-xs text-fg-dim">
                      {tr('settings.appleMusicFlacNote')}
                    </p>
                  )}
                </div>
              </>
            )}

            {STEPS[step] === 'audio' && (
              <>
                <h2 id="onboarding-step-title" className="mb-1 text-lg font-semibold">
                  {tr('onboarding.audioTitle')}
                </h2>
                <p className="mb-4 text-sm text-fg-dim">{tr('onboarding.audioBody')}</p>
                <div className="flex flex-col gap-3" data-testid="onboarding-audio-intents">
                  {/* Correct metadata is what Surco is for — shown ticked and disabled so
                      the DJ reads it as always-on, not as something they could turn off. */}
                  <label className="flex cursor-not-allowed items-start gap-3 opacity-80">
                    <input
                      type="checkbox"
                      checked
                      disabled
                      className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
                    />
                    <span className="text-sm">
                      {tr('onboarding.intent.metadata')}
                      <span className="mt-0.5 block text-xs text-fg-dim">
                        {tr('onboarding.intent.metadataBody')}
                      </span>
                    </span>
                  </label>
                  {AUDIO_INTENTS.map((intent) => (
                    <label key={intent} className="flex cursor-pointer items-start gap-3">
                      <input
                        data-testid={`onboarding-intent-${intent}`}
                        type="checkbox"
                        checked={audioIntents.includes(intent)}
                        onChange={(e) => toggleIntent(intent, e.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
                      />
                      <span className="text-sm">
                        {tr(`onboarding.intent.${intent}`)}
                        <span className="mt-0.5 block text-xs text-fg-dim">
                          {tr(`onboarding.intent.${intent}Body`)}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                {/* The spectrum is the payload of the quality intent — show the same
                    illustration the old spectrum step had, but only once it's opted into. */}
                {audioIntents.includes('quality') && (
                  <div className="mt-4">
                    <SpectrumPreview />
                  </div>
                )}
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
                className="press rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
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

const PREVIEW_NYQUIST = 22050
const PREVIEW_CUTOFF = 16000
const PREVIEW_FREQ_MARKS = [0, 5000, 10000, 15000, 20000]
// Deterministic vertical "transients" so the illustration reads like a real spectrogram
// without bundling an image; index-derived so it's stable across renders.
const PREVIEW_STREAKS = Array.from({ length: 64 }, (_, i) => ({
  x: (i + 0.5) / 64,
  o: 0.05 + ((i * 37) % 9) / 36,
}))

// A faked spectrogram shown in the wizard's spectrum step: it teaches what the real
// analysis looks like (energy fading toward the top, a cutoff line where a re-encoded
// lossy file falls off) before the user has loaded a track. Blue to match the app's
// cividis palette; the labels sit on the dark image, so it reads in both themes.
function SpectrumPreview(): React.JSX.Element {
  const { t: tr } = useTranslation()
  const cutoffTop = (1 - PREVIEW_CUTOFF / PREVIEW_NYQUIST) * 100
  return (
    <div
      data-testid="spectrum-preview"
      className="relative w-full overflow-hidden rounded-lg border border-[var(--color-line)]"
    >
      <svg
        viewBox="0 0 320 160"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="block h-40 w-full"
      >
        <defs>
          <linearGradient id="surco-spectrum-preview" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0a1124" />
            <stop offset="55%" stopColor="#1b3a6b" />
            <stop offset="100%" stopColor="#3f6fb0" />
          </linearGradient>
          {/* Yellow low-frequency energy fading up into the blue, matching the app's
              cividis spectrogram (navy at the top, yellow where the energy is loudest). */}
          <linearGradient id="surco-spectrum-energy" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#ffe24d" stopOpacity="0.9" />
            <stop offset="16%" stopColor="#e6d24e" stopOpacity="0.4" />
            <stop offset="40%" stopColor="#e6d24e" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width="320" height="160" fill="url(#surco-spectrum-preview)" />
        {PREVIEW_STREAKS.map((s) => (
          <line
            key={s.x}
            x1={s.x * 320}
            x2={s.x * 320}
            y1="0"
            y2="160"
            stroke="#bcdcff"
            strokeWidth="1"
            opacity={s.o}
          />
        ))}
        {/* The loudest energy lives in the low frequencies at the bottom. */}
        <rect y="96" width="320" height="64" fill="url(#surco-spectrum-energy)" />
        {/* A lossy file re-encoded as lossless drops off above the cutoff. */}
        <rect width="320" height={(cutoffTop / 100) * 160} fill="#0a1124" opacity="0.5" />
      </svg>
      {PREVIEW_FREQ_MARKS.map((f) => (
        <span
          key={f}
          style={{ top: `${(1 - f / PREVIEW_NYQUIST) * 100}%` }}
          className="pointer-events-none absolute left-1 -translate-y-1/2 rounded bg-black/55 px-1 text-[10px] tabular-nums text-white"
        >
          {f / 1000}k
        </span>
      ))}
      <div
        style={{ top: `${cutoffTop}%` }}
        className="pointer-events-none absolute inset-x-0 border-t border-dashed border-white/70"
      >
        <span className="absolute right-1 top-0.5 rounded bg-black/65 px-1 text-[10px] font-medium text-white">
          {tr('editor.spectrumCutoff', { cutoff: formatKHz(PREVIEW_CUTOFF) })}
        </span>
      </div>
    </div>
  )
}
