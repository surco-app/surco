// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// SettingsModal reads window.api.platform at module load, so stub it before the
// component is imported.
vi.hoisted(() => {
  ;(globalThis.window as Window & { api?: unknown }).api = { platform: 'darwin' }
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
  trimWhitespace: true,
  zeroPadTrack: true,
  visibleFields: [],
  requiredFields: [],
  coverMaxSize: 1200,
  coverSquare: false,
  showSpectrum: true,
  hasSeenOnboarding: true,
}

function openNaming() {
  render(<SettingsModal settings={settings} onClose={() => {}} onSave={() => {}} />)
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
})
