// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// OnboardingWizard's tree reads window.api.platform at module load, so stub it first.
vi.hoisted(() => {
  ;(globalThis.window as unknown as { api: unknown }).api = {
    platform: 'darwin',
    // The wizard asks both on mount to list the collections it found.
    rekordboxCollection: async () => '',
    detectTraktorNmlPath: async () => null,
  }
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
  keepMp3Sources: false,
  addToAppleMusic: false,
  keepOutputCopy: true,
  overwriteOriginal: false,
  convertBesideOriginal: false,
  backupPolicy: 'always',
  backupRetentionDays: 30,
  backupMaxGb: 10,
  addToEngineDj: false,
  engineLibraryDir: '/music/Engine Library',
  traktorNmlPath: '',
  rekordboxDbPath: '',
  syncTraktor: false,
  syncRekordbox: false,
  betaUpdates: false,
  traktorCueOffsetMs: 0,
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
  showEditorHints: true,
  autoMatch: false,
  continuousPlayback: false,
  keyNotation: 'camelot',
  normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
  declick: 'off',
  shortcutOverrides: {},
  editorSections: DEFAULT_EDITOR_SECTIONS,
  commandUsage: {},
  hasSeenOnboarding: false,
  deezerProviderMigrated: true,
  conversionCount: 0,
  stats: {
    imported: 0,
    listened: 0,
    analyzed: 0,
    discogsMatches: 0,
    bandcampMatches: 0,
    deezerMatches: 0,
  },
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

type WizardApi = {
  api: {
    rekordboxCollection: () => Promise<string>
    detectTraktorNmlPath: () => Promise<string | null>
    pickOutputDir?: () => Promise<string>
    pickEngineLibraryDir?: () => Promise<string>
  }
}
const wizardApi = window as unknown as WizardApi

function next(times = 1): void {
  for (let i = 0; i < times; i++) fireEvent.click(screen.getByTestId('onboarding-next'))
}

describe('OnboardingWizard where the file is saved', () => {
  function openFormatStep(onFinish: (patch: Partial<Settings>) => void = () => {}) {
    render(<OnboardingWizard settings={settings} onFinish={onFinish} />)
    next(2)
  }

  it('asks the location next to the format, with the output folder under it', async () => {
    wizardApi.api.pickOutputDir = vi.fn(async () => '/dj/converted')
    const onFinish = vi.fn()
    openFormatStep(onFinish)
    expect(screen.getByTestId('onboarding-location-folder')).toBeChecked()
    expect(screen.getByTestId('onboarding-output')).toHaveTextContent('/out')
    fireEvent.click(screen.getByTestId('onboarding-output-change'))
    expect(await screen.findByTestId('onboarding-output')).toHaveTextContent('/dj/converted')
    next(3)
    expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ outputDir: '/dj/converted' }))
  })

  it('persists saving beside the original', () => {
    const onFinish = vi.fn()
    openFormatStep(onFinish)
    fireEvent.click(screen.getByTestId('onboarding-location-beside'))
    next(3)
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ convertBesideOriginal: true, overwriteOriginal: false }),
    )
  })

  it('does not offer the destructive overwrite', () => {
    openFormatStep()
    expect(screen.queryByTestId('onboarding-location-overwrite')).toBeNull()
  })

  it('keeps the output folder on screen whatever location is chosen', () => {
    openFormatStep()
    fireEvent.click(screen.getByTestId('onboarding-location-beside'))
    expect(screen.getByTestId('onboarding-output').closest('[inert]')).toBeNull()
  })
})

describe('OnboardingWizard what the DJ plays with', () => {
  async function openDjStep(
    current: Settings = settings,
    onFinish: (patch: Partial<Settings>) => void = () => {},
  ) {
    render(<OnboardingWizard settings={current} onFinish={onFinish} />)
    next(4)
    await screen.findByTestId('onboarding-dj-engineDj')
  }

  it('is its own last step, asked of every DJ', async () => {
    await openDjStep()
    expect(screen.getByText(i18n.t('onboarding.step', { current: 5, total: 5 }))).toBeVisible()
    expect(screen.getByTestId('onboarding-dj-appleMusic')).toBeInTheDocument()
    expect(screen.getByTestId('onboarding-dj-rekordbox')).toBeInTheDocument()
    expect(screen.getByTestId('onboarding-dj-traktor')).toBeInTheDocument()
  })

  it('persists Apple Music without a folder copy', async () => {
    const onFinish = vi.fn()
    await openDjStep({ ...settings, addToAppleMusic: false }, onFinish)
    fireEvent.click(screen.getByTestId('onboarding-dj-appleMusic'))
    next()
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ addToAppleMusic: true, keepOutputCopy: false }),
    )
  })

  it('persists Apple Music and Engine DJ together', async () => {
    const onFinish = vi.fn()
    await openDjStep({ ...settings, addToAppleMusic: true, keepOutputCopy: false }, onFinish)
    fireEvent.click(screen.getByTestId('onboarding-dj-engineDj'))
    next()
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ addToAppleMusic: true, addToEngineDj: true }),
    )
  })

  it('persists the Engine library folder picked under its chip', async () => {
    wizardApi.api.pickEngineLibraryDir = async () => '/dj/Engine Library'
    const onFinish = vi.fn()
    await openDjStep(settings, onFinish)
    expect(screen.getByTestId('onboarding-engine-playlist')).toHaveValue('Surco')
    fireEvent.click(screen.getByTestId('onboarding-dj-engineDj'))
    fireEvent.click(screen.getByTestId('onboarding-engine-library-change'))
    expect(await screen.findByTestId('onboarding-engine-library')).toHaveTextContent(
      '/dj/Engine Library',
    )
    next()
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ addToEngineDj: true, engineLibraryDir: '/dj/Engine Library' }),
    )
  })

  it('keeps FLAC out of Apple Music with the reason', async () => {
    render(<OnboardingWizard settings={settings} onFinish={() => {}} />)
    next(2)
    fireEvent.click(screen.getByTestId('onboarding-format-flac'))
    next(2)
    expect(await screen.findByTestId('onboarding-dj-appleMusic')).toBeDisabled()
    expect(screen.getByText(i18n.t('settings.appleMusicFlacNote'))).toBeInTheDocument()
  })

  it('disables the libraries with the reason while saving beside the original', async () => {
    render(<OnboardingWizard settings={settings} onFinish={() => {}} />)
    next(2)
    fireEvent.click(screen.getByTestId('onboarding-location-beside'))
    next(2)
    expect(await screen.findByTestId('onboarding-dj-engineDj')).toBeDisabled()
    expect(screen.getByTestId('onboarding-dj-appleMusic')).toBeDisabled()
  })

  it('offers a rekordbox collection it found, off by default, with its path', async () => {
    wizardApi.api.rekordboxCollection = async () => '/Users/dj/Library/Pioneer/rekordbox/master.db'
    try {
      const onFinish = vi.fn()
      await openDjStep(settings, onFinish)
      const chip = await screen.findByTestId('onboarding-dj-rekordbox')
      await vi.waitFor(() => expect(chip).toBeEnabled())
      expect(chip).not.toBeChecked()
      expect(screen.getByText('/Users/dj/Library/Pioneer/rekordbox/master.db')).toBeVisible()
      fireEvent.click(chip)
      next()
      expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ syncRekordbox: true }))
    } finally {
      wizardApi.api.rekordboxCollection = async () => ''
    }
  })

  it('disables rekordbox and Traktor with the reason when neither was found', async () => {
    await openDjStep()
    expect(screen.getByTestId('onboarding-dj-rekordbox')).toBeDisabled()
    expect(screen.getByTestId('onboarding-dj-traktor')).toBeDisabled()
    expect(screen.getByText(i18n.t('settings.syncRekordboxIdle'))).toBeInTheDocument()
  })

  it('saves the Traktor collection it found when the DJ ticks it', async () => {
    wizardApi.api.detectTraktorNmlPath = async () => '/Users/dj/Documents/NI/collection.nml'
    try {
      const onFinish = vi.fn()
      await openDjStep(settings, onFinish)
      expect(await screen.findByTestId('onboarding-traktor-nml')).toHaveTextContent(
        '/Users/dj/Documents/NI/collection.nml',
      )
      fireEvent.click(screen.getByTestId('onboarding-dj-traktor'))
      next()
      expect(onFinish).toHaveBeenCalledWith(
        expect.objectContaining({
          syncTraktor: true,
          traktorNmlPath: '/Users/dj/Documents/NI/collection.nml',
        }),
      )
    } finally {
      wizardApi.api.detectTraktorNmlPath = async () => null
    }
  })

  it('keeps a Traktor collection path the DJ already set', async () => {
    wizardApi.api.detectTraktorNmlPath = async () => '/Users/dj/Documents/NI/collection.nml'
    try {
      const onFinish = vi.fn()
      await openDjStep({ ...settings, traktorNmlPath: '/Volumes/iCloud/collection.nml' }, onFinish)
      fireEvent.click(await screen.findByTestId('onboarding-dj-traktor'))
      next()
      expect(onFinish).toHaveBeenCalledWith(
        expect.objectContaining({
          syncTraktor: true,
          traktorNmlPath: '/Volumes/iCloud/collection.nml',
        }),
      )
    } finally {
      wizardApi.api.detectTraktorNmlPath = async () => null
    }
  })

  it('leaves Apple Music out on Windows', async () => {
    ;(window.api as unknown as { platform: string }).platform = 'win32'
    try {
      await openDjStep()
      expect(screen.getByTestId('onboarding-dj-engineDj')).toBeInTheDocument()
      expect(screen.queryByTestId('onboarding-dj-appleMusic')).toBeNull()
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
    next(2)
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
    next(2)
    const patch = onFinish.mock.calls[0][0] as Partial<Settings>
    const shown = (patch.editorSections ?? []).filter((s) => !s.hidden).map((s) => s.id)
    expect(shown).toEqual(expect.arrayContaining(['trim', 'declick']))
  })

  // A re-run opens with the checkboxes reading the DJ's current editor, so Finish
  // without touching anything cannot change the layout.
  it('seeds the audio intents from the current editor on a re-run', () => {
    const rerun: Settings = {
      ...settings,
      hasSeenOnboarding: true,
      showSpectrum: false,
      editorSections: DEFAULT_EDITOR_SECTIONS.map((s) =>
        s.id === 'trim' || s.id === 'declick' ? { ...s, hidden: true } : s,
      ),
    }
    render(<OnboardingWizard settings={rerun} onFinish={vi.fn()} />)
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(screen.getByTestId('onboarding-intent-restore')).not.toBeChecked()
    expect(screen.getByTestId('onboarding-intent-level')).toBeChecked()
    expect(screen.getByTestId('onboarding-intent-quality')).not.toBeChecked()
  })

  it('finishing an untouched re-run leaves the editor layout as it was', () => {
    const onFinish = vi.fn()
    const rerun: Settings = { ...settings, hasSeenOnboarding: true }
    render(<OnboardingWizard settings={rerun} onFinish={onFinish} />)
    next(5)
    expect(onFinish).toHaveBeenCalledOnce()
    expect(onFinish.mock.calls[0][0].editorSections).toEqual(rerun.editorSections)
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
    next(3)
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
  // the first import — sources + token + auto-match, format + location, the audio
  // workflow and what the DJ plays with — and defers power-user tuning (naming, presets,
  // fields) to Settings.
  it('reaches Finish on the fifth step', () => {
    render(<OnboardingWizard settings={settings} onFinish={() => {}} />)
    next(4)
    expect(screen.getByTestId('onboarding-next')).toHaveTextContent(i18n.t('onboarding.finish'))
  })
})
