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
  autoMatch: false,
  normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
  shortcutOverrides: {},
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
  // other editor-behavior switches under the Editor tab, not in General.
  it('shows the audio spectrum toggle under the Editor tab, not General', () => {
    render(
      <SettingsModal
        settings={settings}
        onClose={() => {}}
        onSave={() => {}}
        onPreviewTheme={() => {}}
      />,
    )
    expect(screen.queryByTestId('settings-show-spectrum')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('settings-tab-editor'))
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

  // The toolbar stats icon opens settings straight on this tab, so a caller can
  // land the user on the time-saved view without an extra click.
  it('opens directly on the stats tab when asked', () => {
    render(
      <SettingsModal
        settings={{ ...settings, conversionCount: 142 }}
        onClose={() => {}}
        onSave={() => {}}
        onPreviewTheme={() => {}}
        initialTab="stats"
      />,
    )
    expect(screen.getByTestId('stats-count')).toBeInTheDocument()
  })
})

describe('SettingsModal shortcuts', () => {
  function openShortcuts(onSave: (p: Partial<Settings>) => void = () => {}) {
    render(
      <SettingsModal
        settings={settings}
        onClose={() => {}}
        onSave={onSave}
        onPreviewTheme={() => {}}
        initialTab="shortcuts"
      />,
    )
  }

  function record(id: string, keyInit: Partial<KeyboardEventInit> & { key: string }) {
    fireEvent.click(screen.getByTestId(`shortcut-record-${id}`))
    fireEvent.keyDown(screen.getByTestId(`shortcut-record-${id}`), keyInit)
  }

  // Recording a keystroke must rebind the command and persist it like any setting, so
  // the user's choice survives the save and reaches the keymap.
  it('records a new chord and saves it as an override', () => {
    const onSave = vi.fn()
    openShortcuts(onSave)
    record('add', { key: 'a', metaKey: true, shiftKey: true })
    expect(screen.getByTestId('shortcut-record-add')).toHaveTextContent('⌘⇧A')
    fireEvent.click(screen.getByTestId('settings-save'))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ shortcutOverrides: { add: ['mod', 'shift', 'a'] } }),
    )
  })

  it('resets a single command back to its default', () => {
    openShortcuts()
    record('add', { key: 'a', metaKey: true, shiftKey: true })
    fireEvent.click(screen.getByTestId('shortcut-reset-add'))
    expect(screen.getByTestId('shortcut-record-add')).toHaveTextContent('⌘O')
  })

  it('reset all clears every override', () => {
    const onSave = vi.fn()
    openShortcuts(onSave)
    record('add', { key: 'a', metaKey: true, shiftKey: true })
    fireEvent.click(screen.getByTestId('shortcuts-reset-all'))
    expect(screen.getByTestId('shortcut-record-add')).toHaveTextContent('⌘O')
    fireEvent.click(screen.getByTestId('settings-save'))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ shortcutOverrides: {} }))
  })

  // Two commands on one chord is ambiguous, so the clash is surfaced and saving is
  // blocked until it's resolved — no silently-broken binding gets persisted.
  it('flags a conflict and disables save when two commands share a chord', () => {
    openShortcuts()
    record('add', { key: 'r', metaKey: true }) // ⌘R already belongs to reveal
    expect(screen.getByTestId('shortcuts-conflict')).toBeInTheDocument()
    expect(screen.getByTestId('settings-save')).toBeDisabled()
  })

  // ⌘K opens the palette and isn't reconfigurable; recording it must be rejected so it
  // can't be stolen.
  it('rejects the reserved palette chord (⌘K)', () => {
    const onSave = vi.fn()
    openShortcuts(onSave)
    record('add', { key: 'k', metaKey: true })
    fireEvent.click(screen.getByTestId('settings-save'))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ shortcutOverrides: {} }))
  })
})
