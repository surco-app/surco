// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// OnboardingWizard's tree reads window.api.platform at module load, so stub it first.
vi.hoisted(() => {
  ;(globalThis.window as unknown as { api: unknown }).api = { platform: 'darwin' }
})

import '../i18n'
import type { Settings } from '../../../shared/types'
import { OnboardingWizard } from './OnboardingWizard'

afterEach(cleanup)

const settings: Settings = {
  theme: 'system',
  language: 'system',
  discogsToken: '',
  discogsFormats: [],
  discogsMaxResults: 10,
  searchProviders: ['discogs'],
  outputDir: '/out',
  outputFormat: 'aiff',
  addToAppleMusic: false,
  keepOutputCopy: true,
  overwriteOriginal: false,
  addToEngineDj: false,
  engineLibraryDir: '/music/Engine Library',
  engineDjPlaylist: 'Surco',
  filenameFormat: '',
  autoApplyFilename: false,
  groupingPresets: [],
  genrePresets: [],
  trimWhitespace: true,
  zeroPadTrack: true,
  visibleFields: [],
  requiredFields: [],
  coverMaxSize: 1200,
  coverSquare: false,
  replaceLowResCover: false,
  mp3Quality: '320',
  showSpectrum: true,
  activityPanel: null,
  autoAnalyze: false,
  showWaveform: true,
  showLoudness: true,
  autoMatch: false,
  continuousPlayback: false,
  keyNotation: 'camelot',
  normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
  shortcutOverrides: {},
  commandUsage: {},
  hasSeenOnboarding: false,
  conversionCount: 0,
  donateNudgeDismissed: false,
  donateNudgeLastShown: '',
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
    // format → naming → grouping → genre → required → spectrum, then finish.
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ addToAppleMusic: true, keepOutputCopy: false }),
    )
  })

  // Apple Music can't ingest FLAC, so choosing it pins the destination to the always-valid
  // output folder and locks the Apple Music options out.
  it('pins the destination to the output folder and disables Apple Music for FLAC', () => {
    openFormatStep()
    fireEvent.click(screen.getByTestId('onboarding-format-flac'))
    expect(screen.getByTestId('onboarding-destination-folder')).toBeChecked()
    expect(screen.getByTestId('onboarding-destination-appleMusic')).toBeDisabled()
  })
})

describe('OnboardingWizard fields', () => {
  // The Fields step now embeds the same editor as Settings, so a new user can pick which
  // fields show and which are required in one place rather than only toggling required.
  it('shows the shared fields editor reflecting the current visible and required fields', () => {
    render(
      <OnboardingWizard
        settings={{ ...settings, visibleFields: ['title', 'artist'], requiredFields: ['title'] }}
        onFinish={() => {}}
      />,
    )
    // welcome → token → format → naming → grouping → genre → fields
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(screen.getByTestId('field-row-title')).toBeInTheDocument()
    expect(screen.getByTestId('field-required-title')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('field-required-artist')).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('OnboardingWizard spectrum', () => {
  // The spectrum step shows a faked spectrogram so a brand-new user (no tracks loaded yet)
  // can see what the feature is — including the lossy-cutoff line it's there to reveal.
  it('illustrates the spectrum with a preview and a cutoff marker', () => {
    render(<OnboardingWizard settings={settings} onFinish={() => {}} />)
    // welcome → token → format → naming → grouping → genre → fields → spectrum
    for (let i = 0; i < 7; i++) fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(screen.getByTestId('spectrum-preview')).toBeInTheDocument()
    expect(screen.getByText(/cutoff/i)).toBeInTheDocument()
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
})
