// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// OnboardingWizard's tree reads window.api.platform at module load, so stub it first.
vi.hoisted(() => {
  ;(globalThis.window as unknown as { api: unknown }).api = {
    platform: 'darwin',
    // The wizard asks both on mount to decide whether the collections step exists at all.
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
  beatportUsername: '',
  beatportPassword: '',
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
  genreSeparator: ', ',
  groupingSeparator: ', ',
  trimWhitespace: true,
  zeroPadTrack: true,
  fullReleaseDate: false,
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
  backupPolicyMigrated: true,
  trackImportFieldsMigrated: true,
  conversionCount: 0,
  stats: {
    imported: 0,
    listened: 0,
    analyzed: 0,
    discogsMatches: 0,
    bandcampMatches: 0,
    deezerMatches: 0,
    beatportMatches: 0,
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

describe('OnboardingWizard step focus', () => {
  // Going back to the first step unmounts Back, the button that held the focus: it fell to
  // body, outside the focus trap. Landing on the new step's heading keeps it in the dialog
  // and makes VoiceOver read which step the user is on.
  it('moves the focus to the new step heading on every step change, back to the first too', () => {
    render(<OnboardingWizard settings={settings} onFinish={() => {}} />)
    fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2 }))
    expect(document.activeElement).not.toHaveTextContent(i18n.t('onboarding.welcomeTitle'))
    fireEvent.click(screen.getByTestId('onboarding-back'))
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { level: 2, name: i18n.t('onboarding.welcomeTitle') }),
    )
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
    expect(screen.getByTestId('onboarding-output')).toHaveTextContent('/out')
    fireEvent.click(screen.getByTestId('onboarding-output-change'))
    expect(await screen.findByTestId('onboarding-output')).toHaveTextContent('/dj/converted')
    for (let i = 0; i < 2; i++) fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ outputDir: '/dj/converted' }))
  })

  // Overwrite rewrites every source file in place, and the wizard runs before the user
  // has loaded a single track — so the one destructive choice is the one they have no
  // way to judge yet. Settings still offers it, with the editor's overwrite warnings
  // behind it; the first-run wizard must not.
  it('does not offer the destructive overwrite destination', () => {
    openFormatStep()
    expect(screen.queryByTestId('onboarding-destination-overwrite')).toBeNull()
  })

  it('hides the folder detail under destinations that keep no folder copy', () => {
    openFormatStep()
    fireEvent.click(screen.getByTestId('onboarding-destination-beside'))
    // Kept mounted for the collapse animation; inert is what "hidden" means here.
    expect(screen.getByTestId('onboarding-output').closest('[inert]')).not.toBeNull()
  })

  // Apple Music can't ingest FLAC, so choosing it pins the destination to the always-valid
  // output folder and locks the Apple Music options out.
  it('pins the destination to the output folder and disables Apple Music for FLAC', () => {
    openFormatStep()
    fireEvent.click(screen.getByTestId('onboarding-format-flac'))
    expect(screen.getByTestId('onboarding-destination-folder')).toBeChecked()
    expect(screen.getByTestId('onboarding-destination-appleMusic')).toBeDisabled()
    // The greyed radio alone doesn't say WHY — the same note Settings shows names
    // the limitation here too.
    expect(screen.getByText(i18n.t('settings.appleMusicFlacNote'))).toBeInTheDocument()
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

  // The wizard offered Engine DJ as a destination and then asked nothing else, so a new
  // user finished setup with the destination set and the library pointing at a default
  // folder that need not exist — on the machine this was found on, it did not. Settings
  // has always shown these two fields under the same radio; the wizard now does too.
  it('asks where the Engine DJ library is once Engine DJ is the destination', () => {
    openFormatStep()
    expect(screen.getByTestId('onboarding-engine-library').closest('[inert]')).not.toBeNull()

    fireEvent.click(screen.getByTestId('onboarding-destination-engineDj'))
    expect(screen.getByTestId('onboarding-engine-library').closest('[inert]')).toBeNull()
    expect(screen.getByTestId('onboarding-engine-playlist')).toHaveValue('Surco')
  })

  it('persists the library folder the user picks for Engine DJ', async () => {
    ;(
      window as unknown as { api: { pickEngineLibraryDir?: () => Promise<string> } }
    ).api.pickEngineLibraryDir = async () => '/dj/Engine Library'
    const onFinish = vi.fn()
    openFormatStep(onFinish)
    fireEvent.click(screen.getByTestId('onboarding-destination-engineDj'))
    fireEvent.click(screen.getByTestId('onboarding-engine-library-change'))
    expect(await screen.findByTestId('onboarding-engine-library')).toHaveTextContent(
      '/dj/Engine Library',
    )

    for (let i = 0; i < 2; i++) fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ addToEngineDj: true, engineLibraryDir: '/dj/Engine Library' }),
    )
  })

  // A DJ finished setup without ever hearing that Surco can keep their collection in step
  // with what it converts — the thing that saves them rebuilding playlists by hand. The
  // step only appears for a collection actually found, so it costs nothing to anyone else.
  it('offers the collections it found, off by default', async () => {
    ;(
      window as unknown as { api: { rekordboxCollection?: () => Promise<string> } }
    ).api.rekordboxCollection = async () => '/Users/dj/Library/Pioneer/rekordbox/master.db'
    const onFinish = vi.fn()
    render(<OnboardingWizard settings={settings} onFinish={onFinish} />)
    // The detection resolves after mount, and it is what decides the wizard's length —
    // clicking through before it lands would walk a four-step wizard off its end.
    expect(
      await screen.findByText(i18n.t('onboarding.step', { current: 1, total: 5 })),
    ).toBeInTheDocument()

    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('onboarding-next'))
    const toggle = await screen.findByTestId('onboarding-sync-rekordbox')
    expect(toggle).not.toBeChecked()

    fireEvent.click(toggle)
    fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ syncRekordbox: true }))
  })

  // Traktor sync writes into the collection.nml it is given and skips entirely without one,
  // so ticking the collection the wizard found has to save that path along with the toggle.
  it('saves the Traktor collection it found when the DJ ticks it', async () => {
    const api = window as unknown as {
      api: {
        rekordboxCollection: () => Promise<string>
        detectTraktorNmlPath: () => Promise<string | null>
      }
    }
    api.api.rekordboxCollection = async () => ''
    api.api.detectTraktorNmlPath = async () => '/Users/dj/Documents/NI/collection.nml'
    try {
      const onFinish = vi.fn()
      render(<OnboardingWizard settings={settings} onFinish={onFinish} />)
      expect(
        await screen.findByText(i18n.t('onboarding.step', { current: 1, total: 5 })),
      ).toBeInTheDocument()
      for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('onboarding-next'))
      fireEvent.click(await screen.findByTestId('onboarding-sync-traktor'))
      fireEvent.click(screen.getByTestId('onboarding-next'))
      expect(onFinish).toHaveBeenCalledWith(
        expect.objectContaining({
          syncTraktor: true,
          traktorNmlPath: '/Users/dj/Documents/NI/collection.nml',
        }),
      )
    } finally {
      api.api.detectTraktorNmlPath = async () => null
    }
  })

  // A DJ re-running the wizard may already point Surco at a collection outside the standard
  // folder; the detected one must not quietly replace the path they chose.
  it('keeps a Traktor collection path the DJ already set', async () => {
    const api = window as unknown as {
      api: {
        rekordboxCollection: () => Promise<string>
        detectTraktorNmlPath: () => Promise<string | null>
      }
    }
    api.api.rekordboxCollection = async () => ''
    api.api.detectTraktorNmlPath = async () => '/Users/dj/Documents/NI/collection.nml'
    try {
      const onFinish = vi.fn()
      render(
        <OnboardingWizard
          settings={{ ...settings, traktorNmlPath: '/Volumes/iCloud/collection.nml' }}
          onFinish={onFinish}
        />,
      )
      expect(
        await screen.findByText(i18n.t('onboarding.step', { current: 1, total: 5 })),
      ).toBeInTheDocument()
      for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('onboarding-next'))
      fireEvent.click(await screen.findByTestId('onboarding-sync-traktor'))
      fireEvent.click(screen.getByTestId('onboarding-next'))
      expect(onFinish).toHaveBeenCalledWith(
        expect.objectContaining({
          syncTraktor: true,
          traktorNmlPath: '/Volumes/iCloud/collection.nml',
        }),
      )
    } finally {
      api.api.detectTraktorNmlPath = async () => null
    }
  })

  // Someone who runs no DJ software should not be shown a step with nothing in it, and the
  // counter has to agree: five of five when the step is there, four of four when it is not.
  it('leaves the step out entirely when no collection was found', async () => {
    ;(
      window as unknown as { api: { rekordboxCollection?: () => Promise<string> } }
    ).api.rekordboxCollection = async () => ''
    render(<OnboardingWizard settings={settings} onFinish={vi.fn()} />)

    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(
      await screen.findByText(i18n.t('onboarding.step', { current: 4, total: 4 })),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('onboarding-sync-rekordbox')).not.toBeInTheDocument()
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
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByTestId('onboarding-next'))
    fireEvent.click(screen.getByTestId('onboarding-next'))
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
