// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// OnboardingWizard's tree reads window.api.platform at module load, so stub it first.
vi.hoisted(() => {
  ;(globalThis.window as unknown as { api: unknown }).api = { platform: 'darwin' }
})

import { SEARCH_PROVIDERS } from '../../../shared/defaults'
import { DEFAULT_EDITOR_SECTIONS } from '../../../shared/editorSections'
import { FORMAT_SETTINGS } from '../../../shared/outputFormats'
import type { Settings } from '../../../shared/types'
import i18n from '../i18n'
import { OnboardingWizard } from './OnboardingWizard'

afterEach(cleanup)

const settings: Settings = {
  theme: 'system',
  language: 'system',
  discogsToken: '',
  discogsFormats: [],
  discogsMaxResults: 10,
  searchProviders: ['discogs'],
  searchIgnoreWords: [],
  outputDir: '/out',
  outputFormat: 'aiff',
  addToAppleMusic: false,
  keepOutputCopy: true,
  overwriteOriginal: false,
  convertBesideOriginal: false,
  addToEngineDj: false,
  engineLibraryDir: '/music/Engine Library',
  engineDjPlaylist: 'Surco',
  filenameFormat: '',
  titleFormat: '',
  autoApplyFilename: false,
  groupingPresets: [],
  genrePresets: [],
  trimWhitespace: true,
  zeroPadTrack: true,
  visibleFields: [],
  requiredFields: [],
  coverMaxSize: 1200,
  coverSquare: false,
  coverUpscale: false,
  replaceLowResCover: false,
  flacFinderCovers: false,
  mp3Quality: '320',
  outputBitDepth: 'source',
  outputSampleRate: 'source',
  flacCompression: '5',
  showSpectrum: true,
  activityPanel: null,
  resultsWidth: null,
  autoAnalyze: false,
  showWaveform: true,
  showLoudness: true,
  autoMatch: false,
  continuousPlayback: false,
  keyNotation: 'camelot',
  normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
  declick: 'off',
  shortcutOverrides: {},
  editorSections: DEFAULT_EDITOR_SECTIONS,
  commandUsage: {},
  hasSeenOnboarding: false,
  conversionCount: 0,
  stats: { imported: 0, listened: 0, analyzed: 0, discogsMatches: 0, bandcampMatches: 0 },
  donateNudgeDismissed: false,
  donateNudgeLastShown: '',
  lastSeenChangelogVersion: '',
}

function openTokenStep(onFinish: (patch: Partial<Settings>) => void = () => {}) {
  render(<OnboardingWizard settings={settings} onFinish={onFinish} />)
  fireEvent.click(screen.getByTestId('onboarding-next')) // welcome → token step
}

describe('OnboardingWizard keyboard', () => {
  // The wizard is a form whose default button is Next, so pressing Enter in a field
  // advances the step instead of doing nothing.
  it('advances to the next step when the form is submitted with Enter', () => {
    render(<OnboardingWizard settings={settings} onFinish={() => {}} />)
    expect(screen.queryByTestId('onboarding-token')).toBeNull()
    fireEvent.submit(screen.getByTestId('onboarding-next').closest('form') as HTMLFormElement)
    expect(screen.getByTestId('onboarding-token')).toBeInTheDocument()
  })
})

describe('OnboardingWizard destination', () => {
  function openFormatStep(onFinish: (patch: Partial<Settings>) => void = () => {}) {
    render(<OnboardingWizard settings={settings} onFinish={onFinish} />)
    fireEvent.click(screen.getByTestId('onboarding-next')) // welcome → token
    fireEvent.click(screen.getByTestId('onboarding-next')) // token → format
  }

  // A new macOS user who picks "Apple Music only" in the format step must have it
  // persisted on finish — otherwise the default would silently keep the folder copy too.
  it('persists the destination chosen in the format step when the wizard finishes', () => {
    const onFinish = vi.fn()
    openFormatStep(onFinish)
    fireEvent.click(screen.getByTestId('onboarding-destination-appleMusic'))
    // format → spectrum, then finish.
    for (let i = 0; i < 2; i++) fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ addToAppleMusic: true, keepOutputCopy: false }),
    )
  })

  // The wizard's whole point is configuring the first conversion — and WHERE the files
  // land is the first thing a new user will look for after it. The folder shows (and is
  // changeable) right under its radio, exactly like Settings, and only for the choice
  // it applies to.
  it('shows the output folder under its radio and persists a changed one', async () => {
    ;(window as unknown as { api: { pickOutputDir?: () => Promise<string> } }).api.pickOutputDir =
      vi.fn(async () => '/dj/converted')
    const onFinish = vi.fn()
    openFormatStep(onFinish)
    expect(screen.getByTestId('onboarding-output-dir')).toHaveValue('/out')
    fireEvent.click(screen.getByTestId('onboarding-output-change'))
    expect(await screen.findByTestId('onboarding-output-dir')).toHaveValue('/dj/converted')
    for (let i = 0; i < 2; i++) fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ outputDir: '/dj/converted' }))
  })

  it('hides the folder detail under destinations that keep no folder copy', () => {
    openFormatStep()
    fireEvent.click(screen.getByTestId('onboarding-destination-beside'))
    // Kept mounted for the collapse animation; inert is what "hidden" means here.
    expect(screen.getByTestId('onboarding-output-dir').closest('[inert]')).not.toBeNull()
  })

  // Apple Music can't ingest FLAC, so choosing it pins the destination to the always-valid
  // output folder and locks the Apple Music options out.
  it('pins the destination to the output folder and disables Apple Music for FLAC', () => {
    openFormatStep()
    fireEvent.click(screen.getByTestId('onboarding-format-flac'))
    expect(screen.getByTestId('onboarding-destination-folder')).toBeChecked()
    expect(screen.getByTestId('onboarding-destination-appleMusic')).toBeDisabled()
  })

  // Engine DJ is a first-class destination in Settings; a new user setting Surco up for a
  // Denon workflow must be able to pick it here rather than discover Settings later.
  it('offers Engine DJ and persists it when chosen', () => {
    const onFinish = vi.fn()
    openFormatStep(onFinish)
    fireEvent.click(screen.getByTestId('onboarding-destination-engineDj'))
    for (let i = 0; i < 2; i++) fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({
        addToEngineDj: true,
        addToAppleMusic: false,
        keepOutputCopy: true,
      }),
    )
  })

  // The destination choice is no longer macOS-only: Engine DJ and overwrite exist on every
  // platform, so Windows gets the step too — minus Apple Music, which only exists on macOS.
  it('shows the destination step without Apple Music on Windows', () => {
    ;(window.api as unknown as { platform: string }).platform = 'win32'
    try {
      openFormatStep()
      expect(screen.getByTestId('onboarding-destination-folder')).toBeInTheDocument()
      expect(screen.getByTestId('onboarding-destination-engineDj')).toBeInTheDocument()
      expect(screen.queryByTestId('onboarding-destination-appleMusic')).toBeNull()
    } finally {
      ;(window.api as unknown as { platform: string }).platform = 'darwin'
    }
  })
})

describe('OnboardingWizard audio intents', () => {
  function openAudioStep(onFinish: (patch: Partial<Settings>) => void = () => {}) {
    render(<OnboardingWizard settings={settings} onFinish={onFinish} />)
    // welcome → token → format → audio
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByTestId('onboarding-next'))
  }

  // The spectrum illustration is the payload of the "check quality" intent: it shows the
  // faked spectrogram (with its lossy-cutoff line) only once that intent is picked, so a
  // metadata-only DJ never meets it. The fixture seeds showSpectrum:true → intent picked.
  it('illustrates the spectrum only while the quality intent is picked', () => {
    openAudioStep()
    expect(screen.getByTestId('onboarding-intent-quality')).toBeChecked()
    expect(screen.getByTestId('spectrum-preview')).toBeInTheDocument()
    expect(screen.getByText(/cutoff/i)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('onboarding-intent-quality'))
    expect(screen.queryByTestId('spectrum-preview')).toBeNull()
  })

  // The core promise of the reworked wizard: a DJ who only wants correct metadata leaves
  // the audio-surgery sections hidden. Unpicking quality (the only seeded intent) and
  // finishing must persist an editor layout with trim/declick/normalize hidden and the
  // spectrum off — no audio tools the DJ never asked for.
  it('persists a metadata-only layout when no audio intent is picked', () => {
    const onFinish = vi.fn()
    openAudioStep(onFinish)
    fireEvent.click(screen.getByTestId('onboarding-intent-quality')) // unpick the seeded one
    fireEvent.click(screen.getByTestId('onboarding-next')) // finish
    const patch = onFinish.mock.calls[0][0] as Partial<Settings>
    expect(patch.showSpectrum).toBe(false)
    const hidden = (patch.editorSections ?? []).filter((s) => s.hidden).map((s) => s.id)
    expect(hidden).toEqual(expect.arrayContaining(['trim', 'declick', 'normalize']))
  })

  // Picking "restore vinyl" must reveal the vinyl-repair sections in the persisted layout,
  // so a vinyl DJ's first editor already has trim and declick without a Settings trip.
  it('reveals the vinyl-repair sections when the restore intent is picked', () => {
    const onFinish = vi.fn()
    openAudioStep(onFinish)
    fireEvent.click(screen.getByTestId('onboarding-intent-restore'))
    fireEvent.click(screen.getByTestId('onboarding-next')) // finish
    const patch = onFinish.mock.calls[0][0] as Partial<Settings>
    const shown = (patch.editorSections ?? []).filter((s) => !s.hidden).map((s) => s.id)
    expect(shown).toEqual(expect.arrayContaining(['trim', 'declick']))
  })
})

describe('OnboardingWizard search providers', () => {
  // The same guard the format step has: both surfaces render from SEARCH_PROVIDERS
  // itself, so a catalog source added for Settings can't silently skip new users.
  it('offers every catalog source Settings offers', () => {
    openTokenStep()
    for (const p of SEARCH_PROVIDERS) {
      expect(screen.getByTestId(`onboarding-provider-${p}`)).toBeInTheDocument()
    }
  })
})

describe('OnboardingWizard token field', () => {
  // The wizard's token field must tell the same story Settings tells: without the
  // "why" line a new user has no reason to leave the wizard for discogs.com, and the
  // two surfaces drift the moment one wording changes.
  it('explains why a personal token helps, with the same words Settings uses', () => {
    openTokenStep()
    expect(screen.getByText(i18n.t('settings.tokenWhy'), { exact: false })).toBeInTheDocument()
  })
})

describe('OnboardingWizard auto-match', () => {
  // Auto-match needs the user's own Discogs token (its own rate-limit bucket) and spends a lot
  // of requests, so the wizard can't let it be turned on until a token is entered.
  it('disables the auto-match toggle until a token is entered', () => {
    openTokenStep()
    expect(screen.getByTestId('onboarding-auto-match')).toBeDisabled()
    fireEvent.change(screen.getByTestId('onboarding-token'), { target: { value: 'tok' } })
    expect(screen.getByTestId('onboarding-auto-match')).toBeEnabled()
  })

  // With every source unticked the blocker is the missing source, not the token — Settings
  // already explains it that way, and a wizard that says "add a token" would send the user
  // hunting for a field that isn't even shown (it only renders while Discogs is on).
  it('explains that auto-match needs a source when every provider is unticked', () => {
    openTokenStep()
    fireEvent.click(screen.getByTestId('onboarding-provider-discogs'))
    expect(screen.getByTestId('onboarding-auto-match')).toBeDisabled()
    expect(screen.getByText(i18n.t('settings.autoMatchNeedsSource'))).toBeInTheDocument()
  })
})

describe('OnboardingWizard format', () => {
  function openFormatStep(
    current: Settings = settings,
    onFinish: (patch: Partial<Settings>) => void = () => {},
  ) {
    render(<OnboardingWizard settings={current} onFinish={onFinish} />)
    fireEvent.click(screen.getByTestId('onboarding-next')) // welcome → token
    fireEvent.click(screen.getByTestId('onboarding-next')) // token → format
  }

  // The wizard and Settings render the same format choice; when they drift, a value
  // added in Settings silently never reaches new users (exactly how 'source' went
  // missing here). Asserting against FORMAT_SETTINGS itself means a future format
  // can't be added to one surface without the other.
  it('offers every format Settings offers, Same as source first', () => {
    openFormatStep()
    for (const f of FORMAT_SETTINGS) {
      expect(screen.getByTestId(`onboarding-format-${f}`)).toBeInTheDocument()
    }
    const group = screen.getByTestId('onboarding-format-source').parentElement as HTMLElement
    expect(group.querySelector('[data-testid^="onboarding-format-"]')).toBe(
      screen.getByTestId('onboarding-format-source'),
    )
  })

  it('persists Same as source when picked', () => {
    const onFinish = vi.fn()
    openFormatStep(settings, onFinish)
    fireEvent.click(screen.getByTestId('onboarding-format-source'))
    for (let i = 0; i < 2; i++) fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ outputFormat: 'source' }))
  })

  // Re-running the wizard used to narrow a stored 'source' to AIFF, silently dropping
  // the user's choice on the very screen meant to confirm it.
  it('keeps a stored Same as source selected on re-run', () => {
    openFormatStep({ ...settings, outputFormat: 'source' })
    expect(screen.getByTestId('onboarding-format-source')).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('OnboardingWizard length', () => {
  // Every extra question delays the first drop of files. The wizard asks only what shapes
  // the first import — sources + token + auto-match, format + destination, and the audio
  // workflow — and defers power-user tuning (naming, presets, fields) to Settings.
  it('reaches Finish on the fourth step', () => {
    render(<OnboardingWizard settings={settings} onFinish={() => {}} />)
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(screen.getByTestId('onboarding-next')).toHaveTextContent(i18n.t('onboarding.finish'))
  })
})
