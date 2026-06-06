// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// SettingsModal reads window.api.platform at module load, so stub it before the
// component is imported.
vi.hoisted(() => {
  ;(globalThis.window as unknown as { api: unknown }).api = { platform: 'darwin' }
})

import '../i18n'
import type { Settings } from '../../../shared/types'
import { SettingsModal } from './SettingsModal'

afterEach(cleanup)

const settings: Settings = {
  theme: 'system',
  discogsToken: '',
  outputDir: '/out',
  outputFormat: 'aiff',
  addToAppleMusic: false,
  filenameFormat: '',
  groupingPresets: [],
  genrePresets: [],
  trimWhitespace: true,
  zeroPadTrack: true,
  visibleFields: [],
  requiredFields: [],
  coverMaxSize: 1200,
  coverSquare: false,
  showSpectrum: true,
  showLoudness: true,
  normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
  hasSeenOnboarding: true,
  conversionCount: 0,
}

function openNaming() {
  render(
    <SettingsModal
      settings={settings}
      onClose={() => {}}
      onSave={() => {}}
      onPreviewTheme={() => {}}
    />,
  )
  fireEvent.click(screen.getByTestId('settings-tab-naming'))
}

describe('SettingsModal filename tokens', () => {
  // The whole point of the feature: users who don't know the token names just
  // click the field they want and it lands in the format.
  it('inserts a token into the format when its chip is clicked', () => {
    openNaming()
    fireEvent.click(screen.getByTestId('settings-token-albumArtist'))
    expect(screen.getByTestId('settings-filename-format')).toHaveValue('{albumArtist}')
  })

  it('previews the rendered file name from the sample track', () => {
    openNaming()
    fireEvent.click(screen.getByTestId('settings-token-artist'))
    fireEvent.click(screen.getByTestId('settings-token-title'))
    expect(screen.getByTestId('settings-format-preview')).toHaveTextContent(
      'Dj VixentTake me into the sky.aiff',
    )
  })

  it('closes when the backdrop is clicked', () => {
    const onClose = vi.fn()
    render(
      <SettingsModal
        settings={settings}
        onClose={onClose}
        onSave={() => {}}
        onPreviewTheme={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('settings-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('SettingsModal theme preview', () => {
  // Picking a theme should apply it live so the user sees the result before
  // committing; the parent reverts the preview if they cancel instead of saving.
  it('previews the chosen theme without saving', () => {
    const onPreviewTheme = vi.fn()
    const onSave = vi.fn()
    render(
      <SettingsModal
        settings={settings}
        onClose={() => {}}
        onSave={onSave}
        onPreviewTheme={onPreviewTheme}
      />,
    )
    fireEvent.click(screen.getByTestId('settings-theme-dark'))
    expect(onPreviewTheme).toHaveBeenCalledWith('dark')
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('SettingsModal organization', () => {
  // The spectrum toggle controls what the editor shows, so it belongs with the
  // other editing-behavior switches under the Editing tab, not in General.
  it('shows the audio spectrum toggle under the Editing tab, not General', () => {
    render(
      <SettingsModal
        settings={settings}
        onClose={() => {}}
        onSave={() => {}}
        onPreviewTheme={() => {}}
      />,
    )
    expect(screen.queryByTestId('settings-show-spectrum')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('settings-tab-naming'))
    expect(screen.getByTestId('settings-show-spectrum')).toBeInTheDocument()
  })
})

describe('SettingsModal stats', () => {
  // The whole reason for the tab: turn a raw tally into the "time you saved"
  // story we want to tell users, derived from the count, not the audio length.
  it('shows the conversion count and the estimated time saved', () => {
    render(
      <SettingsModal
        settings={{ ...settings, conversionCount: 142 }}
        onClose={() => {}}
        onSave={() => {}}
        onPreviewTheme={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('settings-tab-stats'))
    expect(screen.getByTestId('stats-count')).toHaveTextContent('142')
    expect(screen.getByTestId('stats-time-saved')).toHaveTextContent('9 h 28 min')
  })

  // Before the first conversion, "0" and "0 min" would read as broken; explain the
  // value instead so the empty state still earns its place.
  it('explains the value instead of showing zeros before the first conversion', () => {
    render(
      <SettingsModal
        settings={settings}
        onClose={() => {}}
        onSave={() => {}}
        onPreviewTheme={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('settings-tab-stats'))
    expect(screen.getByTestId('stats-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('stats-count')).not.toBeInTheDocument()
  })

  // The donate ask only earns its place once there's a saved-time story to back
  // it — asking before the first conversion would feel like a paywall.
  it('offers the sponsor link only after time has been saved', () => {
    const { rerender } = render(
      <SettingsModal
        settings={settings}
        onClose={() => {}}
        onSave={() => {}}
        onPreviewTheme={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('settings-tab-stats'))
    expect(screen.queryByTestId('stats-sponsor')).not.toBeInTheDocument()

    rerender(
      <SettingsModal
        settings={{ ...settings, conversionCount: 142 }}
        onClose={() => {}}
        onSave={() => {}}
        onPreviewTheme={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('settings-tab-stats'))
    expect(screen.getByTestId('stats-sponsor')).toBeInTheDocument()
  })

  // The toolbar stats icon opens settings straight on this tab, so a caller can
  // land the user on the time-saved + donate view without an extra click.
  it('opens directly on the stats tab when asked', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(
      <SettingsModal
        settings={{ ...settings, conversionCount: 142 }}
        onClose={() => {}}
        onSave={() => {}}
        onPreviewTheme={() => {}}
        initialTab="stats"
      />,
    )
    fireEvent.click(screen.getByTestId('stats-sponsor'))
    expect(open).toHaveBeenCalledWith('https://github.com/sponsors/vigosan')
    open.mockRestore()
  })
})
