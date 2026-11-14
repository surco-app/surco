// @vitest-environment jsdom
import { BUNDLED_FLOWS } from '../../../shared/cueFlows'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// OnboardingWizard's tree reads window.api.platform at module load, so stub it first.
const detected = vi.hoisted(() => {
  const found: Record<string, () => Promise<boolean>> = {}
  ;(globalThis.window as unknown as { api: unknown }).api = {
    platform: 'darwin',
    // The wizard asks both on mount to decide whether the collections step exists at all.
    rekordboxCollection: async () => '',
    detectTraktorNmlPath: async () => null,
    dj: { available: async (program: string) => (found[program] ?? (async () => false))() },
  }
  return found
})

import { SEARCH_PROVIDERS } from '../../../shared/defaults'
import { DEFAULT_EDITOR_SECTIONS } from '../../../shared/editorSections'
import { FORMAT_SETTINGS } from '../../../shared/outputFormats'
import { DEFAULT_SESSION_WIZARD } from '../../../shared/sessionSettings'
import type { Settings } from '../../../shared/types'
import i18n from '../i18n'
import { OnboardingWizard } from './OnboardingWizard'

afterEach(cleanup)

const settings: Settings = {
  theme: 'system',
  density: 'normal',
  showListWaves: true,
  showRailNames: true,
  showSidebar: true,
  cueFlows: BUNDLED_FLOWS,
  activeCueFlow: 'mine',
  cueJumpBars: 16,
  cueQuantize: 'bar',
  cueGridTolerance: 10,
  cueLettersByTime: true,
  cueFlowToRekordbox: true,
  cueFlowToTraktor: true,
  cueFlowToEngine: true,
  cueFlowToSerato: true,
  cueFlowToVirtualdj: true,
  cueLearnFromEdits: true,
  hiddenSources: [],
  sessionWizard: { ...DEFAULT_SESSION_WIZARD },
  sessionsMade: [],
  language: 'system',
  discogsToken: '',
  beatportUsername: '',
  beatportPassword: '',
  discogsFormats: [],
  discogsMaxResults: 10,
  searchProviders: ['discogs'],
  searchIgnoreWords: [],
  searchByAlbumFirst: false,
  autoCleanSpacing: false,
  autoCleanCase: false,
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
  analysisCacheGb: 10,
  addToEngineDj: false,
  addToRekordbox: false,
  addToTraktor: false,
  engineLibraryDir: '/music/Engine Library',
  traktorNmlPath: '',
  rekordboxDbPath: '',
  syncTraktor: false,
  syncRekordbox: false,
  completeCuesOnClose: false,
  rekordboxPlaylistsFieldOffered: false,
  traktorPlaylistsFieldOffered: false,
  enginePlaylistsFieldOffered: false,
  seratoPlaylistsFieldOffered: false,
  virtualdjPlaylistsFieldOffered: false,
  virtualdjLibraryDir: '/Users/dj/Library/Application Support/VirtualDJ',
  syncEngineDj: false,
  addToSerato: false,
  syncSerato: false,
  addToVirtualdj: false,
  syncVirtualdj: false,
  betaUpdates: false,
  autoUpdates: true,
  traktorCueOffsetMs: 0,
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
  asciiFileNames: false,
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
  declick: { mode: 'off', noise: 'off' },
  shortcutOverrides: {},
  editorSections: DEFAULT_EDITOR_SECTIONS,
  commandUsage: {},
  musicReviewIgnored: [],
  listReviewIgnored: [],
  hasSeenOnboarding: false,
  deezerProviderMigrated: true,
  musicbrainzProviderMigrated: true,
  backupPolicyMigrated: true,
  backupLimitsMigrated: true,
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
    musicbrainzMatches: 0,
  },
  donateNudgeDismissed: false,
  donateNudgeLastShown: '',
  lastSeenChangelogVersion: '',
}

const STEP_MARK = {
  programs: 'onboarding-sync-none',
  format: 'onboarding-destination-folder',
  audio: 'onboarding-audio-intents',
  search: 'onboarding-search-providers',
} as const

function next(): void {
  fireEvent.click(screen.getByTestId('onboarding-next'))
}

function goTo(step: keyof typeof STEP_MARK): void {
  for (let i = 0; i < 6 && !screen.queryByTestId(STEP_MARK[step]); i++) next()
  expect(screen.getByTestId(STEP_MARK[step])).toBeInTheDocument()
}

function finishWizard(): void {
  const finish = i18n.t('onboarding.finish')
  for (let i = 0; i < 6 && screen.getByTestId('onboarding-next').textContent !== finish; i++) next()
  next()
}

function openTokenStep(onFinish: (patch: Partial<Settings>) => void = () => {}) {
  render(<OnboardingWizard settings={settings} onFinish={onFinish} />)
  goTo('search')
  fireEvent.click(screen.getByTestId('onboarding-token-add'))
}

describe('OnboardingWizard keyboard', () => {
  // The wizard is a form whose default button is Next, so pressing Enter in a field
  // advances the step instead of doing nothing.
  it('lifts the wizard above the page like every other dialog', () => {
    render(<OnboardingWizard settings={settings} onFinish={() => {}} />)
    expect(screen.getByRole('dialog')).toHaveClass('shadow-modal')
  })

  it('advances to the next step when the form is submitted with Enter', () => {
    render(<OnboardingWizard settings={settings} onFinish={() => {}} />)
    expect(screen.queryByTestId('onboarding-destination-folder')).toBeNull()
    const form = screen.getByTestId('onboarding-next').closest('form') as HTMLFormElement
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(screen.getByTestId('onboarding-destination-folder')).toBeInTheDocument()
  })

  it('opens with the focus on Next so Enter starts the setup instead of skipping it', () => {
    render(<OnboardingWizard settings={settings} onFinish={() => {}} />)
    expect(document.activeElement).toBe(screen.getByTestId('onboarding-next'))
  })
})

describe('OnboardingWizard skip', () => {
  it('keeps the choices already made instead of discarding them when skipping from a later step', () => {
    const onFinish = vi.fn()
    render(<OnboardingWizard settings={settings} onFinish={onFinish} />)
    goTo('format')
    fireEvent.click(screen.getByTestId('onboarding-format-mp3'))
    fireEvent.click(screen.getByTestId('onboarding-skip'))
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ outputFormat: 'mp3', hasSeenOnboarding: true }),
    )
  })

  it('only marks the wizard as seen and names files from tags when a first run is skipped before any choice', () => {
    const onFinish = vi.fn()
    render(<OnboardingWizard settings={settings} onFinish={onFinish} />)
    fireEvent.click(screen.getByTestId('onboarding-skip'))
    expect(onFinish).toHaveBeenCalledWith({ autoApplyFilename: true, hasSeenOnboarding: true })
  })

  it("leaves an existing user's settings alone when a re-run is skipped before any choice", () => {
    const onFinish = vi.fn()
    render(
      <OnboardingWizard settings={{ ...settings, hasSeenOnboarding: true }} onFinish={onFinish} />,
    )
    fireEvent.click(screen.getByTestId('onboarding-skip'))
    expect(onFinish).toHaveBeenCalledWith({ hasSeenOnboarding: true })
  })
})

describe('OnboardingWizard step focus', () => {
  // Going back to the first step unmounts Back, the button that held the focus: it fell to
  // body, outside the focus trap. Landing on the new step's heading keeps it in the dialog
  // and makes VoiceOver read which step the user is on.
  it('moves the focus to the new step heading on every step change, back to the first too', () => {
    render(<OnboardingWizard settings={settings} onFinish={() => {}} />)
    fireEvent.click(screen.getByTestId('onboarding-next'))
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
    goTo('format')
  }

  // A new macOS user who picks "Apple Music only" in the format step must have it
  // persisted on finish — otherwise the default would silently keep the folder copy too.
  it('persists the destination chosen in the format step when the wizard finishes', () => {
    const onFinish = vi.fn()
    openFormatStep(onFinish)
    fireEvent.click(screen.getByTestId('onboarding-destination-appleMusic'))
    finishWizard()
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ addToAppleMusic: true, keepOutputCopy: false }),
    )
  })

  it('describes the output-folder copy an untouched Apple Music default really keeps', () => {
    const onFinish = vi.fn()
    render(
      <OnboardingWizard
        settings={{ ...settings, addToAppleMusic: true, keepOutputCopy: true }}
        onFinish={onFinish}
      />,
    )
    goTo('format')
    expect(screen.getByTestId('onboarding-destination-appleMusic')).toBeChecked()
    expect(screen.getByText(i18n.t('settings.destinationAppleMusicKeepCopyHint'))).toBeVisible()
    expect(screen.queryByText(i18n.t('settings.destinationAppleMusicHint'))).toBeNull()
    finishWizard()
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ addToAppleMusic: true, keepOutputCopy: true }),
    )
  })

  it('describes Apple Music as copy-free once picking it drops the folder copy', () => {
    openFormatStep()
    expect(screen.getByText(i18n.t('settings.destinationAppleMusicHint'))).toBeVisible()
    fireEvent.click(screen.getByTestId('onboarding-destination-appleMusic'))
    expect(screen.getByText(i18n.t('settings.destinationAppleMusicHint'))).toBeVisible()
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
    finishWizard()
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

  it('no longer offers Engine DJ as a destination', () => {
    openFormatStep()
    expect(screen.queryByTestId('onboarding-destination-engineDj')).toBeNull()
    expect(screen.queryByTestId('onboarding-engine-playlist')).toBeNull()
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

  it('keeps a DJ who already sends tracks to Engine DJ doing so whatever destination they pick', () => {
    const onFinish = vi.fn()
    render(<OnboardingWizard settings={{ ...settings, addToEngineDj: true }} onFinish={onFinish} />)
    goTo('format')
    fireEvent.click(screen.getByTestId('onboarding-destination-beside'))
    fireEvent.click(screen.getByTestId('onboarding-destination-folder'))
    finishWizard()
    expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ addToEngineDj: true }))
  })

  // Detection is a nicety: a library probe that fails (an unreadable rekordbox folder) used
  // to reject unhandled, which the app reports as a red error over the very first screen.
  // A failed probe just means no collections step.
  it('treats a failed library detection as no collections found', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    detected.engine = () => Promise.reject(new Error('EACCES'))
    try {
      render(<OnboardingWizard settings={settings} onFinish={vi.fn()} />)
      await new Promise((r) => setTimeout(r, 0))
      expect(unhandled).not.toHaveBeenCalled()
      expect(screen.getByText(i18n.t('onboarding.step', { current: 1, total: 5 }))).toBeVisible()
    } finally {
      detected.engine = async () => false
      process.off('unhandledRejection', unhandled)
    }
  })

  // A slow detection that landed after the user moved on grew the wizard under them: the
  // count jumped from 4 to 5 and the Finish they were about to press became Next. Once the
  // user has left the first step the length is fixed.
  it('keeps the step count it showed once the user has moved past the first step', async () => {
    const api = window as unknown as { api: { rekordboxCollection: () => Promise<string> } }
    let land: (path: string) => void = () => {}
    api.api.rekordboxCollection = () =>
      new Promise<string>((resolve) => {
        land = resolve
      })
    try {
      const onFinish = vi.fn()
      render(<OnboardingWizard settings={settings} onFinish={onFinish} />)
      fireEvent.click(screen.getByTestId('onboarding-next'))
      fireEvent.click(screen.getByTestId('onboarding-next'))
      await act(async () => land('/Users/dj/Library/Pioneer/rekordbox/master.db'))
      expect(screen.getByText(i18n.t('onboarding.step', { current: 3, total: 5 }))).toBeVisible()
      for (let i = 0; i < 2; i++) fireEvent.click(screen.getByTestId('onboarding-next'))
      fireEvent.click(screen.getByTestId('onboarding-next'))
      expect(onFinish).toHaveBeenCalledTimes(1)
    } finally {
      api.api.rekordboxCollection = async () => ''
    }
  })

  // A DJ finished setup without ever hearing that Surco can keep their collection in step
  // with what it converts, and a rekordbox the wizard had found arrived unticked. The step
  // comes right after the welcome and ticks rekordbox and Traktor on a first run.
  it('asks for the DJ software right after the welcome, with rekordbox ticked', async () => {
    ;(
      window as unknown as { api: { rekordboxCollection?: () => Promise<string> } }
    ).api.rekordboxCollection = async () => '/Users/dj/Library/Pioneer/rekordbox/master.db'
    const onFinish = vi.fn()
    render(<OnboardingWizard settings={settings} onFinish={onFinish} />)
    // The detection resolves after mount, and it is what decides the wizard's length —
    // clicking through before it lands would walk a four-step wizard off its end.
    expect(
      await screen.findByText(i18n.t('onboarding.step', { current: 1, total: 6 })),
    ).toBeInTheDocument()

    next()
    next()
    expect(screen.getByText(i18n.t('onboarding.step', { current: 3, total: 6 }))).toBeVisible()
    expect(await screen.findByTestId('onboarding-sync-rekordbox')).toBeChecked()
    finishWizard()
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ syncRekordbox: true, addToRekordbox: true }),
    )
  })

  it.each([
    [0, { syncRekordbox: true, addToRekordbox: false }],
    [1, { syncRekordbox: false, addToRekordbox: false }],
    [2, { syncRekordbox: true, addToRekordbox: true }],
  ])(
    'shows an update-only program as on and keeps it so until it is clicked (%i clicks)',
    async (clicks, expected) => {
      ;(
        window as unknown as { api: { rekordboxCollection?: () => Promise<string> } }
      ).api.rekordboxCollection = async () => '/Users/dj/Library/Pioneer/rekordbox/master.db'
      const onFinish = vi.fn()
      render(
        <OnboardingWizard
          settings={{ ...settings, syncRekordbox: true, addToRekordbox: false }}
          onFinish={onFinish}
        />,
      )
      expect(
        await screen.findByText(i18n.t('onboarding.step', { current: 1, total: 6 })),
      ).toBeInTheDocument()
      goTo('programs')
      const toggle = await screen.findByTestId('onboarding-sync-rekordbox')
      expect(toggle).toBeChecked()
      for (let i = 0; i < clicks; i++) fireEvent.click(toggle)
      finishWizard()
      expect(onFinish).toHaveBeenCalledWith(expect.objectContaining(expected))
    },
  )

  it('asks for the Engine library and the folder for an update-only Engine user', async () => {
    detected.engine = async () => true
    try {
      render(
        <OnboardingWizard
          settings={{ ...settings, syncEngineDj: true, addToEngineDj: false }}
          onFinish={vi.fn()}
        />,
      )
      expect(
        await screen.findByText(i18n.t('onboarding.step', { current: 1, total: 5 })),
      ).toBeInTheDocument()
      goTo('programs')
      expect(await screen.findByTestId('onboarding-engine-library')).toBeInTheDocument()
      expect(screen.getByTestId('onboarding-dj-folder')).toHaveTextContent('/out')
    } finally {
      detected.engine = async () => false
    }
  })

  it('stops both updating and adding to a program the DJ unticks', async () => {
    ;(
      window as unknown as { api: { rekordboxCollection?: () => Promise<string> } }
    ).api.rekordboxCollection = async () => '/Users/dj/Library/Pioneer/rekordbox/master.db'
    const onFinish = vi.fn()
    render(
      <OnboardingWizard
        settings={{ ...settings, syncRekordbox: true, addToRekordbox: true }}
        onFinish={onFinish}
      />,
    )
    expect(
      await screen.findByText(i18n.t('onboarding.step', { current: 1, total: 5 })),
    ).toBeInTheDocument()
    goTo('programs')
    const toggle = await screen.findByTestId('onboarding-sync-rekordbox')
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    finishWizard()
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ syncRekordbox: false, addToRekordbox: false }),
    )
  })

  // Traktor sync writes into the collection.nml it is given and skips entirely without one,
  // so the collection the wizard found and ticked is saved along with the toggle.
  it('saves the Traktor collection it found and ticked', async () => {
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
      goTo('programs')
      expect(await screen.findByTestId('onboarding-sync-traktor')).toBeChecked()
      finishWizard()
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
      goTo('programs')
      expect(await screen.findByTestId('onboarding-sync-traktor')).toBeChecked()
      finishWizard()
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

  it('offers Engine DJ alone and saves its sync when the DJ ticks it', async () => {
    const api = window as unknown as {
      api: {
        rekordboxCollection: () => Promise<string>
      }
    }
    api.api.rekordboxCollection = async () => ''
    detected.engine = async () => true
    try {
      const onFinish = vi.fn()
      render(<OnboardingWizard settings={settings} onFinish={onFinish} />)
      expect(
        await screen.findByText(i18n.t('onboarding.step', { current: 1, total: 5 })),
      ).toBeInTheDocument()
      goTo('programs')
      const toggle = await screen.findByTestId('onboarding-sync-engine')
      expect(toggle).not.toBeChecked()
      expect(screen.getByTestId('onboarding-djlibrary-engine')).toHaveTextContent(
        '/music/Engine Library',
      )
      expect(screen.queryByTestId('onboarding-sync-rekordbox')).not.toBeInTheDocument()
      expect(screen.queryByTestId('onboarding-sync-traktor')).not.toBeInTheDocument()
      fireEvent.click(toggle)
      finishWizard()
      expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ syncEngineDj: true }))
    } finally {
      detected.engine = async () => false
    }
  })

  async function openDjStep(
    wizardSettings: Settings,
    onFinish: (patch: Partial<Settings>) => void = () => {},
  ) {
    render(<OnboardingWizard settings={wizardSettings} onFinish={onFinish} />)
    expect(
      await screen.findByText(i18n.t('onboarding.step', { current: 1, total: 5 })),
    ).toBeInTheDocument()
    goTo('programs')
  }

  it('tells a DJ where the files will live', async () => {
    const api = window as unknown as {
      api: { rekordboxCollection: () => Promise<string>; pickOutputDir?: () => Promise<string> }
    }
    api.api.rekordboxCollection = async () => '/Users/dj/Library/Pioneer/rekordbox/master.db'
    api.api.pickOutputDir = vi.fn(async () => '/dj/converted')
    try {
      const onFinish = vi.fn()
      await openDjStep(settings, onFinish)
      expect(await screen.findByTestId('onboarding-dj-folder')).toHaveTextContent('/out')
      fireEvent.click(screen.getByTestId('onboarding-dj-folder-change'))
      expect(await screen.findByTestId('onboarding-dj-folder')).toHaveTextContent('/dj/converted')
      finishWizard()
      expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ outputDir: '/dj/converted' }))
    } finally {
      api.api.rekordboxCollection = async () => ''
    }
  })

  it.each([
    ['Apple Music', { addToAppleMusic: true, keepOutputCopy: false }],
    ['beside the original', { convertBesideOriginal: true }],
  ])('leaves the folder line out when the files go to %s', async (_, destination) => {
    const api = window as unknown as { api: { rekordboxCollection: () => Promise<string> } }
    api.api.rekordboxCollection = async () => '/Users/dj/Library/Pioneer/rekordbox/master.db'
    try {
      await openDjStep({ ...settings, ...destination })
      expect(await screen.findByTestId('onboarding-sync-rekordbox')).toBeChecked()
      expect(screen.queryByTestId('onboarding-dj-folder')).not.toBeInTheDocument()
    } finally {
      api.api.rekordboxCollection = async () => ''
    }
  })

  it('asks for the Engine library under Engine', async () => {
    const api = window as unknown as {
      api: { dj: { pickLibraryPath?: () => Promise<string> } }
    }
    detected.engine = async () => true
    api.api.dj.pickLibraryPath = vi.fn(async () => '/Volumes/USB/Engine Library')
    try {
      const onFinish = vi.fn()
      await openDjStep(settings, onFinish)
      expect(screen.queryByTestId('onboarding-engine-library')).not.toBeInTheDocument()
      fireEvent.click(await screen.findByTestId('onboarding-sync-engine'))
      expect(screen.getByTestId('onboarding-engine-library')).toHaveTextContent(
        '/music/Engine Library',
      )
      fireEvent.click(screen.getByTestId('onboarding-engine-library-change'))
      expect(await screen.findByTestId('onboarding-engine-library')).toHaveTextContent(
        '/Volumes/USB/Engine Library',
      )
      finishWizard()
      expect(onFinish).toHaveBeenCalledWith(
        expect.objectContaining({
          syncEngineDj: true,
          addToEngineDj: true,
          engineLibraryDir: '/Volumes/USB/Engine Library',
        }),
      )
    } finally {
      detected.engine = async () => false
    }
  })

  // Someone who runs no DJ software should not be shown a step with nothing in it, and the
  // counter has to agree: five of five when the step is there, four of four when it is not.
  it('leaves the step out entirely when no collection was found', async () => {
    ;(
      window as unknown as { api: { rekordboxCollection?: () => Promise<string> } }
    ).api.rekordboxCollection = async () => ''
    render(<OnboardingWizard settings={settings} onFinish={vi.fn()} />)

    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(
      await screen.findByText(i18n.t('onboarding.step', { current: 5, total: 5 })),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('onboarding-sync-rekordbox')).not.toBeInTheDocument()
  })

  // The destination choice is no longer macOS-only: beside-original exists on every
  // platform, so Windows gets the step too — minus Apple Music, which only exists on macOS.
  it('shows the destination step without Apple Music on Windows', () => {
    ;(window.api as unknown as { platform: string }).platform = 'win32'
    try {
      openFormatStep()
      expect(screen.getByTestId('onboarding-destination-folder')).toBeInTheDocument()
      expect(screen.getByTestId('onboarding-destination-beside')).toBeInTheDocument()
      expect(screen.queryByTestId('onboarding-destination-appleMusic')).toBeNull()
    } finally {
      ;(window.api as unknown as { platform: string }).platform = 'darwin'
    }
  })

  it('checks the output folder on Windows when the synced settings came from a Mac on Apple Music', () => {
    ;(window.api as unknown as { platform: string }).platform = 'win32'
    try {
      render(
        <OnboardingWizard
          settings={{ ...settings, addToAppleMusic: true, keepOutputCopy: false }}
          onFinish={() => {}}
        />,
      )
      goTo('format')
      expect(screen.getByTestId('onboarding-destination-folder')).toBeChecked()
    } finally {
      ;(window.api as unknown as { platform: string }).platform = 'darwin'
    }
  })
})

describe('OnboardingWizard audio intents', () => {
  function openAudioStep(onFinish: (patch: Partial<Settings>) => void = () => {}) {
    render(<OnboardingWizard settings={settings} onFinish={onFinish} />)
    goTo('audio')
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
    fireEvent.click(screen.getByTestId('onboarding-intent-quality'))
    finishWizard()
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
    finishWizard()
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
    goTo('audio')
    expect(screen.getByTestId('onboarding-intent-restore')).not.toBeChecked()
    expect(screen.getByTestId('onboarding-intent-level')).toBeChecked()
    expect(screen.getByTestId('onboarding-intent-quality')).not.toBeChecked()
  })

  it('finishing an untouched re-run leaves the editor layout as it was', () => {
    const onFinish = vi.fn()
    const rerun: Settings = { ...settings, hasSeenOnboarding: true }
    render(<OnboardingWizard settings={rerun} onFinish={onFinish} />)
    finishWizard()
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

  it('says the token is only optional for search, not for auto-match', () => {
    openTokenStep()
    expect(screen.getByTestId('onboarding-token').parentElement).toHaveTextContent(/auto-match/i)
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
    goTo('format')
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

  it('titles the step after both the format and the destination it sets', () => {
    openFormatStep()
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      i18n.t('onboarding.formatTitle'),
    )
  })

  it('lists ALAC among the lossless formats so picking it does not read as losing quality', () => {
    openFormatStep()
    expect(screen.getByText(i18n.t('settings.outputFormatHint'))).toHaveTextContent(/ALAC/)
  })

  it('persists Same as source when picked', () => {
    const onFinish = vi.fn()
    openFormatStep(settings, onFinish)
    fireEvent.click(screen.getByTestId('onboarding-format-source'))
    finishWizard()
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
  it('reaches Finish on the fifth screen, the first being the question about this Mac', () => {
    render(<OnboardingWizard settings={settings} onFinish={() => {}} />)
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(screen.getByTestId('onboarding-next')).toHaveTextContent(i18n.t('onboarding.finish'))
  })

  // The footer showed "Step 3 of 5" in words next to Back and Next. A row of dots says the
  // same at a glance, and the words stay for screen readers inside the dots.
  it('shows progress as one dot per step with the current one marked', () => {
    render(<OnboardingWizard settings={settings} onFinish={() => {}} />)
    next()
    next()
    const dots = screen.getByTestId('onboarding-step-dots')
    expect(within(dots).getAllByTestId(/^onboarding-step-dot-\d+$/)).toHaveLength(5)
    expect(screen.getByTestId('onboarding-step-dot-2')).toHaveAttribute('data-current')
    expect(screen.getByTestId('onboarding-step-dot-1')).not.toHaveAttribute('data-current')
    expect(dots).toHaveTextContent(i18n.t('onboarding.step', { current: 3, total: 5 }))
  })
})

describe('OnboardingWizard DJ software', () => {
  type DetectionApi = {
    api: {
      rekordboxCollection: () => Promise<string>
    }
  }
  const api = window as unknown as DetectionApi
  afterEach(() => {
    api.api.rekordboxCollection = async () => ''
    detected.engine = async () => false
    detected.serato = async () => false
    detected.virtualdj = async () => false
  })

  // Writing into Engine DJ or Serato is opted into, since the DJ cannot rebuild those
  // libraries: found, they are offered but left for the DJ to tick.
  it('leaves Engine DJ and Serato unticked on a first run, and shows Serato without a path', async () => {
    api.api.rekordboxCollection = async () => '/Users/dj/Library/Pioneer/rekordbox/master.db'
    detected.engine = async () => true
    detected.serato = async () => true
    render(<OnboardingWizard settings={settings} onFinish={vi.fn()} />)
    expect(
      await screen.findByText(i18n.t('onboarding.step', { current: 1, total: 5 })),
    ).toBeInTheDocument()
    goTo('programs')
    expect(screen.getByTestId('onboarding-sync-rekordbox')).toBeChecked()
    expect(screen.getByTestId('onboarding-sync-engine')).not.toBeChecked()
    expect(screen.getByTestId('onboarding-sync-serato')).not.toBeChecked()
    expect(screen.queryByTestId('onboarding-djlibrary-serato')).toBeNull()
  })

  // The answer decides what the DJ sees: a rekordbox DJ no longer meets three other
  // programs in the sidebar and their playlist rows on every track.
  it('hides the programs not picked from the sidebar when it finishes', async () => {
    api.api.rekordboxCollection = async () => '/Users/dj/Library/Pioneer/rekordbox/master.db'
    const onFinish = vi.fn()
    render(<OnboardingWizard settings={settings} onFinish={onFinish} />)
    expect(
      await screen.findByText(i18n.t('onboarding.step', { current: 1, total: 5 })),
    ).toBeInTheDocument()
    finishWizard()
    const patch = onFinish.mock.calls[0][0] as Partial<Settings>
    expect(patch.hiddenSources).toEqual(['traktor', 'engine', 'serato', 'virtualdj'])
  })

  it('offers VirtualDJ with its folder, unticked, and keeps its tab only when the DJ picks it', async () => {
    detected.virtualdj = async () => true
    const onFinish = vi.fn()
    render(<OnboardingWizard settings={settings} onFinish={onFinish} />)
    expect(
      await screen.findByText(i18n.t('onboarding.step', { current: 1, total: 5 })),
    ).toBeInTheDocument()
    goTo('programs')
    expect(screen.getByTestId('onboarding-sync-virtualdj')).not.toBeChecked()
    expect(screen.getByTestId('onboarding-djlibrary-virtualdj')).toHaveTextContent(
      settings.virtualdjLibraryDir,
    )
    fireEvent.click(screen.getByTestId('onboarding-sync-virtualdj'))
    expect(screen.getByTestId('onboarding-sync-virtualdj')).toBeChecked()
    expect(screen.getByTestId('onboarding-sync-none')).not.toBeChecked()
    finishWizard()
    const patch = onFinish.mock.calls[0][0] as Partial<Settings>
    expect(patch.hiddenSources).not.toContain('virtualdj')
    expect(patch.hiddenSources).toContain('serato')
  })

  it('turns Serato on for update and add when the DJ ticks it, as for the programs Surco writes to', async () => {
    detected.serato = async () => true
    const onFinish = vi.fn()
    render(<OnboardingWizard settings={settings} onFinish={onFinish} />)
    expect(
      await screen.findByText(i18n.t('onboarding.step', { current: 1, total: 5 })),
    ).toBeInTheDocument()
    goTo('programs')
    fireEvent.click(screen.getByTestId('onboarding-sync-serato'))
    expect(screen.getByTestId('onboarding-sync-serato')).toBeChecked()
    finishWizard()
    expect(onFinish.mock.calls[0][0]).toMatchObject({ syncSerato: true, addToSerato: true })
  })

  it('turns VirtualDJ on for update and add when the DJ ticks it, as for the other programs', async () => {
    detected.virtualdj = async () => true
    const onFinish = vi.fn()
    render(<OnboardingWizard settings={settings} onFinish={onFinish} />)
    expect(
      await screen.findByText(i18n.t('onboarding.step', { current: 1, total: 5 })),
    ).toBeInTheDocument()
    goTo('programs')
    fireEvent.click(screen.getByTestId('onboarding-sync-virtualdj'))
    finishWizard()
    expect(onFinish.mock.calls[0][0]).toMatchObject({ syncVirtualdj: true, addToVirtualdj: true })
  })

  it('unticks VirtualDJ with None too', async () => {
    detected.virtualdj = async () => true
    render(<OnboardingWizard settings={settings} onFinish={vi.fn()} />)
    expect(
      await screen.findByText(i18n.t('onboarding.step', { current: 1, total: 5 })),
    ).toBeInTheDocument()
    goTo('programs')
    fireEvent.click(screen.getByTestId('onboarding-sync-virtualdj'))
    fireEvent.click(screen.getByTestId('onboarding-sync-none'))
    expect(screen.getByTestId('onboarding-sync-virtualdj')).not.toBeChecked()
    expect(screen.getByTestId('onboarding-sync-none')).toBeChecked()
  })

  it('unticks every program with None', async () => {
    api.api.rekordboxCollection = async () => '/Users/dj/Library/Pioneer/rekordbox/master.db'
    render(<OnboardingWizard settings={settings} onFinish={vi.fn()} />)
    expect(
      await screen.findByText(i18n.t('onboarding.step', { current: 1, total: 5 })),
    ).toBeInTheDocument()
    goTo('programs')
    expect(screen.getByTestId('onboarding-sync-none')).not.toBeChecked()
    fireEvent.click(screen.getByTestId('onboarding-sync-none'))
    expect(screen.getByTestId('onboarding-sync-rekordbox')).not.toBeChecked()
    expect(screen.getByTestId('onboarding-sync-none')).toBeChecked()
  })
})

describe('OnboardingWizard destination order', () => {
  // A rekordbox DJ clicked through a Mac wizard that put Apple Music first and ticked, and
  // every conversion landed in a library they never use. The folder leads, Music comes last.
  it('lists the output folder first and Apple Music last', () => {
    render(<OnboardingWizard settings={settings} onFinish={vi.fn()} />)
    goTo('format')
    const order = screen
      .getAllByRole('radio')
      .map((r) => r.getAttribute('data-testid'))
      .filter((id) => id?.startsWith('onboarding-destination-'))
    expect(order).toEqual([
      'onboarding-destination-folder',
      'onboarding-destination-beside',
      'onboarding-destination-appleMusic',
    ])
  })

  // An AIFF that was already AIFF was edited where it sat with no word about it; the step
  // says which tracks stay where they are.
  it('says the tracks already in a collection are updated where they are', () => {
    render(<OnboardingWizard settings={settings} onFinish={vi.fn()} />)
    goTo('format')
    expect(screen.getByTestId('onboarding-destination-note')).toHaveTextContent(
      i18n.t('onboarding.destinationKeepsCollection'),
    )
  })
})

describe('OnboardingWizard token offer', () => {
  // The token asked for first, before a DJ knew what Surco does; search works without it,
  // so the field waits behind a button on the last step.
  it('keeps the token field behind a button until asked for', () => {
    render(<OnboardingWizard settings={settings} onFinish={vi.fn()} />)
    goTo('search')
    expect(screen.queryByTestId('onboarding-token')).toBeNull()
    fireEvent.click(screen.getByTestId('onboarding-token-add'))
    expect(screen.getByTestId('onboarding-token')).toBeInTheDocument()
  })
})

describe('OnboardingWizard welcome', () => {
  const api = (window as unknown as { api: { rekordboxCollection: () => Promise<string> } }).api

  // "Less than a minute" promised the DJ a short setup and then showed a card with nothing
  // on it. The welcome now says what the next steps are, so the minute has a shape.
  it('lists the steps that follow the welcome', async () => {
    api.rekordboxCollection = async () => ''
    render(<OnboardingWizard settings={settings} onFinish={() => {}} />)
    next()
    const steps = within(screen.getByTestId('onboarding-steps')).getAllByRole('listitem')
    expect(steps.map((li) => li.textContent)).toEqual([
      i18n.t('onboarding.formatTitle'),
      i18n.t('onboarding.audioTitle'),
      i18n.t('settings.searchProviders'),
    ])
  })

  // The DJ software step only exists when something was found, so the list must follow the
  // wizard's real length instead of promising a fixed one.
  it('adds the DJ software step to the list when one was found', async () => {
    api.rekordboxCollection = async () => '/Users/dj/Library/Pioneer/rekordbox/master.db'
    render(<OnboardingWizard settings={settings} onFinish={() => {}} />)
    await screen.findByText(i18n.t('onboarding.step', { current: 1, total: 6 }))
    next()
    const steps = within(screen.getByTestId('onboarding-steps')).getAllByRole('listitem')
    expect(steps).toHaveLength(4)
    expect(steps[0]).toHaveTextContent(i18n.t('onboarding.djLibrariesTitle'))
  })
})

describe('OnboardingWizard second Mac', () => {
  type MacApi = {
    pickConfigDir: () => Promise<string | null>
    configDirHasSettings: (dir: string) => Promise<boolean>
    setConfigDir: (dir: string | null) => Promise<Settings>
  }
  const api = (window as unknown as { api: MacApi }).api
  const adopted: Settings = { ...settings, outputFormat: 'flac', outputDir: '/this-mac/out' }

  function offerFolder(dir: string | null, hasSettings: boolean) {
    api.pickConfigDir = async () => dir
    api.configDirHasSettings = async () => hasSettings
    api.setConfigDir = vi.fn(async () => adopted)
    return api.setConfigDir as ReturnType<typeof vi.fn>
  }

  async function pickFolder(): Promise<void> {
    fireEvent.click(screen.getByTestId('onboarding-mac-other'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-mac-pick'))
    })
  }

  it('asks first whether this is the first Mac, answered "yes" by default', () => {
    render(<OnboardingWizard settings={settings} onFinish={() => {}} />)
    expect(screen.getByTestId('onboarding-mac-first')).toBeChecked()
    next()
    expect(screen.getByTestId('onboarding-steps')).toBeInTheDocument()
  })

  it('does not ask on a re-run, where the DJ already went through the wizard', () => {
    render(
      <OnboardingWizard settings={{ ...settings, hasSeenOnboarding: true }} onFinish={() => {}} />,
    )
    expect(screen.queryByTestId('onboarding-mac-first')).toBeNull()
  })

  it('adopts the configuration of the folder picked and tells the app about it', async () => {
    const setConfigDir = offerFolder('/icloud/Surco', true)
    const onSettingsReplaced = vi.fn()
    render(
      <OnboardingWizard
        settings={settings}
        onFinish={() => {}}
        onSettingsReplaced={onSettingsReplaced}
      />,
    )
    await pickFolder()
    expect(setConfigDir).toHaveBeenCalledWith('/icloud/Surco')
    expect(onSettingsReplaced).toHaveBeenCalledWith(adopted)
    expect(screen.getByTestId('onboarding-mac-picked')).toHaveTextContent('/icloud/Surco')
  })

  it('refuses a folder with no Surco configuration and moves nothing', async () => {
    const setConfigDir = offerFolder('/icloud/Empty', false)
    render(<OnboardingWizard settings={settings} onFinish={() => {}} />)
    await pickFolder()
    expect(setConfigDir).not.toHaveBeenCalled()
    expect(screen.getByTestId('onboarding-mac-empty')).toBeInTheDocument()
    expect(screen.getByTestId('onboarding-next')).toBeDisabled()
  })

  it('fills in the Traktor collection found on this Mac when the synced settings sync with Traktor', async () => {
    const detect = window as unknown as {
      api: { detectTraktorNmlPath: () => Promise<string | null> }
    }
    detect.api.detectTraktorNmlPath = async () => '/Users/dj/Traktor/collection.nml'
    api.pickConfigDir = async () => '/icloud/Surco'
    api.configDirHasSettings = async () => true
    api.setConfigDir = async () => ({ ...adopted, syncTraktor: true, addToTraktor: true })
    const onFinish = vi.fn()
    try {
      render(<OnboardingWizard settings={settings} onFinish={onFinish} />)
      await act(async () => {})
      await pickFolder()
      next()
      next()
      expect(onFinish.mock.calls[0][0]).toEqual(
        expect.objectContaining({ traktorNmlPath: '/Users/dj/Traktor/collection.nml' }),
      )
    } finally {
      detect.api.detectTraktorNmlPath = async () => null
    }
  })

  it('says so when the folder cannot be used and stays on the question', async () => {
    api.pickConfigDir = async () => '/readonly/Surco'
    api.configDirHasSettings = async () => true
    api.setConfigDir = async () => {
      throw new Error('EROFS')
    }
    render(<OnboardingWizard settings={settings} onFinish={() => {}} />)
    await pickFolder()
    expect(screen.getByTestId('onboarding-mac-failed')).toBeInTheDocument()
    expect(screen.getByTestId('onboarding-next')).toBeDisabled()
  })

  it('keeps Next disabled until a folder has been adopted', async () => {
    offerFolder(null, false)
    render(<OnboardingWizard settings={settings} onFinish={() => {}} />)
    await pickFolder()
    expect(screen.getByTestId('onboarding-next')).toBeDisabled()
  })

  it('goes straight to what belongs to this Mac and skips the steps that synced', async () => {
    offerFolder('/icloud/Surco', true)
    render(<OnboardingWizard settings={settings} onFinish={() => {}} />)
    await pickFolder()
    next()
    expect(screen.getByTestId('onboarding-output')).toBeInTheDocument()
    expect(screen.queryByTestId('onboarding-steps')).toBeNull()
    expect(
      screen.getByText(i18n.t('onboarding.step', { current: 2, total: 2 })),
    ).toBeInTheDocument()
  })

  it("finishes saving only this Mac's own paths and marking the wizard as seen", async () => {
    offerFolder('/icloud/Surco', true)
    const onFinish = vi.fn()
    render(<OnboardingWizard settings={settings} onFinish={onFinish} />)
    await pickFolder()
    next()
    next()
    expect(onFinish).toHaveBeenCalledTimes(1)
    expect(onFinish.mock.calls[0][0]).toEqual({
      outputDir: '/this-mac/out',
      engineLibraryDir: adopted.engineLibraryDir,
      traktorNmlPath: adopted.traktorNmlPath,
      hasSeenOnboarding: true,
    })
  })
})
