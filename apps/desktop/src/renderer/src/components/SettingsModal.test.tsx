// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// SettingsModal reads window.api.platform at module load, so stub it before the
// component is imported.
vi.hoisted(() => {
  ;(globalThis.window as unknown as { api: unknown }).api = {
    platform: 'darwin',
    getConfigDir: async () => null,
    defaultConfigDir: async () => '/Users/test/Library/Application Support/Surco',
    cacheStats: async () => ({ files: 0, bytes: 0 }),
    clearCache: async () => {},
  }
})

import '../i18n'
import type { Settings } from '../../../shared/types'
import { FIELD_DEFS } from '../lib/fields'
import { DONATE_URL, SettingsModal } from './SettingsModal'

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
  outputBitDepth: 'source',
  outputSampleRate: 'source',
  flacCompression: '5',
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
  hasSeenOnboarding: true,
  conversionCount: 0,
  stats: { imported: 0, listened: 0, analyzed: 0, discogsMatches: 0, bandcampMatches: 0 },
  donateNudgeDismissed: false,
  donateNudgeLastShown: '',
  lastSeenChangelogVersion: '',
}

function openNaming() {
  render(
    <SettingsModal
      settings={settings}
      onClose={() => {}}
      onSave={() => {}}
      onPreviewTheme={() => {}}
      onSettingsReplaced={() => {}}
    />,
  )
  fireEvent.click(screen.getByTestId('settings-tab-naming'))
}

describe('SettingsModal cover size clamp', () => {
  // An invalid cap used to save silently as 1200 — the typed value just vanished on
  // the next open. Clamping visibly on blur shows the figure that will be in effect.
  it('snaps an invalid cover size back to the default where the user can see it', async () => {
    openNaming()
    fireEvent.click(screen.getByTestId('settings-tab-artwork'))
    const input = screen.getByTestId('settings-cover-max') as HTMLInputElement
    fireEvent.change(input, { target: { value: '-5' } })
    fireEvent.blur(input)
    expect(input.value).toBe('1200')
  })
})

describe('SettingsModal tablist', () => {
  function open() {
    render(
      <SettingsModal
        settings={settings}
        onClose={() => {}}
        onSave={() => {}}
        onPreviewTheme={() => {}}
        onSettingsReplaced={() => {}}
      />,
    )
  }

  // The tabs are an ARIA tablist, so a keyboard user moves between them with the
  // arrow keys (and Home/End) the way every native macOS segmented control behaves —
  // not by Tabbing through eight separate buttons.
  it('moves between tabs with the arrow and Home/End keys', () => {
    open()
    const general = screen.getByTestId('settings-tab-general')
    expect(general).toHaveAttribute('role', 'tab')
    expect(general).toHaveAttribute('aria-selected', 'true')
    general.focus()
    fireEvent.keyDown(general, { key: 'ArrowRight' })
    const search = screen.getByTestId('settings-tab-search')
    expect(search).toHaveAttribute('aria-selected', 'true')
    expect(search).toHaveFocus()
    fireEvent.keyDown(search, { key: 'Home' })
    expect(screen.getByTestId('settings-tab-general')).toHaveFocus()
    fireEvent.keyDown(screen.getByTestId('settings-tab-general'), { key: 'ArrowLeft' })
    expect(screen.getByTestId('settings-tab-stats')).toHaveFocus()
  })
})

describe('SettingsModal save', () => {
  // The dialog is a form with a default Save button, so Enter from any field commits
  // the settings instead of doing nothing.
  it('saves when the form is submitted with Enter', () => {
    const onSave = vi.fn()
    render(
      <SettingsModal
        settings={settings}
        onClose={() => {}}
        onSave={onSave}
        onPreviewTheme={() => {}}
        onSettingsReplaced={() => {}}
      />,
    )
    fireEvent.submit(screen.getByTestId('settings-save').closest('form') as HTMLFormElement)
    expect(onSave).toHaveBeenCalled()
  })

  // The UI language is now a persisted setting (General tab), not just the session-only
  // ⌘⇧L toggle, so picking one and saving must carry it through.
  it('saves the chosen UI language', () => {
    const onSave = vi.fn()
    render(
      <SettingsModal
        settings={settings}
        onClose={() => {}}
        onSave={onSave}
        onPreviewTheme={() => {}}
        onSettingsReplaced={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('settings-language-es'))
    fireEvent.click(screen.getByTestId('settings-save'))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ language: 'es' }))
  })
})

describe('SettingsModal auto-match', () => {
  // The Discogs token and auto-match live under the Search tab, so open straight to it.
  function openSearch(onSave: (patch: Partial<Settings>) => void = () => {}) {
    render(
      <SettingsModal
        settings={settings}
        onClose={() => {}}
        onSave={onSave}
        onPreviewTheme={() => {}}
        onSettingsReplaced={() => {}}
        initialTab="search"
      />,
    )
  }

  // Auto-match spends Discogs requests across a whole import, so it needs the user's own token
  // (its own rate-limit bucket). The toggle stays inert until one is entered.
  it('disables the auto-match toggle until a Discogs token is entered', () => {
    openSearch()
    expect(screen.getByTestId('settings-auto-match')).toBeDisabled()
    fireEvent.change(screen.getByTestId('settings-token'), { target: { value: 'tok' } })
    expect(screen.getByTestId('settings-auto-match')).toBeEnabled()
  })

  // Bandcamp is opt-in: ticking it adds the source the editor search queries, alongside
  // Discogs, so the user can reach self-released and Bandcamp-exclusive material.
  it('adds Bandcamp to the searched providers when its checkbox is ticked', () => {
    const onSave = vi.fn()
    openSearch(onSave)
    fireEvent.click(screen.getByTestId('settings-provider-bandcamp'))
    fireEvent.click(screen.getByTestId('settings-save'))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ searchProviders: ['discogs', 'bandcamp'] }),
    )
  })

  // The token, auto-match and format filter only act on Discogs results, so they're
  // disabled (and flagged) when Discogs isn't a chosen source — no inert, confusing controls.
  it('disables the Discogs-only settings when Discogs is not a search source', () => {
    openSearch()
    fireEvent.click(screen.getByTestId('settings-provider-discogs'))
    expect(screen.getByTestId('settings-token')).toBeDisabled()
    expect(screen.getByTestId('settings-auto-match')).toBeDisabled()
    expect(screen.getByTestId('settings-format-Vinyl')).toBeDisabled()
    expect(screen.getByTestId('settings-discogs-disabled')).toBeInTheDocument()
  })

  // Auto-match is a global search setting now: with only Bandcamp as a source it needs no
  // Discogs token, so the toggle must be usable.
  it('enables auto-match for a Bandcamp-only setup without a Discogs token', () => {
    openSearch()
    fireEvent.click(screen.getByTestId('settings-provider-discogs'))
    fireEvent.click(screen.getByTestId('settings-provider-bandcamp'))
    expect(screen.getByTestId('settings-auto-match')).toBeEnabled()
  })

  it('saves auto-match enabled only once a token backs it', () => {
    const onSave = vi.fn()
    openSearch(onSave)
    fireEvent.change(screen.getByTestId('settings-token'), { target: { value: 'tok' } })
    fireEvent.click(screen.getByTestId('settings-auto-match'))
    fireEvent.click(screen.getByTestId('settings-save'))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ discogsToken: 'tok', autoMatch: true }),
    )
  })

  // The format filter lets the user see only certain Discogs release formats (e.g. only
  // vinyl). Checking a box and saving must persist that choice.
  it('saves the chosen Discogs format filter', () => {
    const onSave = vi.fn()
    openSearch(onSave)
    fireEvent.click(screen.getByTestId('settings-format-Vinyl'))
    fireEvent.click(screen.getByTestId('settings-save'))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ discogsFormats: ['Vinyl'] }))
  })
})

describe('SettingsModal destination', () => {
  function openDestination(
    over: Partial<Settings> = {},
    onSave: (p: Partial<Settings>) => void = () => {},
  ) {
    render(
      <SettingsModal
        settings={{ ...settings, ...over }}
        onClose={() => {}}
        onSave={onSave}
        onPreviewTheme={() => {}}
        onSettingsReplaced={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('settings-tab-destination'))
  }

  // The single radio choice is what keeps "no copy anywhere" unrepresentable, so the
  // mapping onto the two stored booleans is the contract worth pinning down.
  it('saves Apple Music as the only destination by dropping the output-folder copy', () => {
    const onSave = vi.fn()
    openDestination({}, onSave)
    fireEvent.click(screen.getByTestId('settings-destination-appleMusic'))
    fireEvent.click(screen.getByTestId('settings-save'))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ addToAppleMusic: true, keepOutputCopy: false }),
    )
  })

  it('reflects a saved "Apple Music only" setting as the selected radio', () => {
    openDestination({ addToAppleMusic: true, keepOutputCopy: false })
    expect(screen.getByTestId('settings-destination-appleMusic')).toBeChecked()
  })

  // "Output folder + Apple Music" was retired: a legacy both-copies setting must show
  // as plain Apple Music instead of leaving no radio selected.
  it('collapses a legacy keep-the-copy Apple Music setting onto the Apple Music radio', () => {
    openDestination({ addToAppleMusic: true, keepOutputCopy: true })
    expect(screen.getByTestId('settings-destination-appleMusic')).toBeChecked()
    expect(screen.queryByTestId('settings-destination-both')).toBeNull()
  })

  // Apple Music can't ingest FLAC, so its options can't be chosen while FLAC is the
  // format — the choice falls back to the always-valid output folder.
  it('pins the destination to the output folder and disables Apple Music for FLAC', () => {
    openDestination({ outputFormat: 'flac', addToAppleMusic: true, keepOutputCopy: false })
    expect(screen.getByTestId('settings-destination-folder')).toBeChecked()
    expect(screen.getByTestId('settings-destination-appleMusic')).toBeDisabled()
  })

  // Overwrite is the one destination that touches the source itself, so picking it must
  // turn its flag on and clear the Apple Music booleans (the file never reaches a library).
  it('saves overwrite by setting the flag and clearing Apple Music', () => {
    const onSave = vi.fn()
    openDestination({}, onSave)
    fireEvent.click(screen.getByTestId('settings-destination-overwrite'))
    fireEvent.click(screen.getByTestId('settings-save'))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ overwriteOriginal: true, addToAppleMusic: false }),
    )
  })

  it('reflects a saved overwrite setting as the selected radio', () => {
    openDestination({ overwriteOriginal: true })
    expect(screen.getByTestId('settings-destination-overwrite')).toBeChecked()
  })

  // FLAC only blocks Apple Music; overwrite rewrites the source in place and stays
  // selectable for any format.
  it('keeps overwrite available while FLAC is the format', () => {
    openDestination({ outputFormat: 'flac' })
    expect(screen.getByTestId('settings-destination-overwrite')).not.toBeDisabled()
  })
})

describe('SettingsModal filename tokens', () => {

  // Rating is the one field outside FIELD_DEFS (the editor draws it as stars), but
  // every metadata field must be usable in the file name — e.g. {rating}/{artist}
  // sorts exports into per-rating folders.
  it('offers a rating chip that inserts {rating}', () => {
    openNaming()
    fireEvent.click(screen.getByTestId('settings-token-rating'))
    expect(screen.getByTestId('settings-filename-format')).toHaveValue('{rating}')
  })
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

  // Every chip must move the preview: a token that renders to nothing reads as
  // "this field doesn't work in file names" even though real tracks fill it.
  it('renders a sample value for every insertable token', () => {
    openNaming()
    const format = screen.getByTestId('settings-filename-format')
    for (const key of [...FIELD_DEFS.map((f) => f.key), 'rating']) {
      fireEvent.change(format, { target: { value: `{${key}}` } })
      expect(screen.getByTestId('settings-format-preview')).not.toHaveTextContent('—')
    }
  })

  it('closes when the backdrop is clicked', () => {
    const onClose = vi.fn()
    render(
      <SettingsModal
        settings={settings}
        onClose={onClose}
        onSave={() => {}}
        onPreviewTheme={() => {}}
        onSettingsReplaced={() => {}}
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
        onSettingsReplaced={() => {}}
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
        onSettingsReplaced={() => {}}
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
        onSettingsReplaced={() => {}}
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
        onSettingsReplaced={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('settings-tab-stats'))
    expect(screen.getByTestId('stats-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('stats-count')).not.toBeInTheDocument()
  })

  // Surco is free forever, so the stats tab — the place that shows the hours the
  // app saved you — is where we ask for support. The link must open in the
  // system browser (target=_blank routes through the window-open handler) and
  // exist even before the first conversion.
  it('offers a donation link in both the filled and empty states', () => {
    render(
      <SettingsModal
        settings={{ ...settings, conversionCount: 142 }}
        onClose={() => {}}
        onSave={() => {}}
        onPreviewTheme={() => {}}
        onSettingsReplaced={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('settings-tab-stats'))
    const donate = screen.getByTestId('stats-donate')
    expect(donate).toHaveAttribute('href', DONATE_URL)
    expect(donate).toHaveAttribute('target', '_blank')
    cleanup()

    render(
      <SettingsModal
        settings={settings}
        onClose={() => {}}
        onSave={() => {}}
        onPreviewTheme={() => {}}
        onSettingsReplaced={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('settings-tab-stats'))
    expect(screen.getByTestId('stats-donate')).toHaveAttribute('href', DONATE_URL)
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
        onSettingsReplaced={() => {}}
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
        onSettingsReplaced={() => {}}
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
    record('add', { key: 'x', metaKey: true, shiftKey: true })
    expect(screen.getByTestId('shortcut-record-add')).toHaveTextContent('⌘⇧X')
    fireEvent.click(screen.getByTestId('settings-save'))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ shortcutOverrides: { add: ['mod', 'shift', 'x'] } }),
    )
  })

  it('resets a single command back to its default', () => {
    openShortcuts()
    record('add', { key: 'x', metaKey: true, shiftKey: true })
    fireEvent.click(screen.getByTestId('shortcut-reset-add'))
    expect(screen.getByTestId('shortcut-record-add')).toHaveTextContent('⌘O')
  })

  it('reset all clears every override', () => {
    const onSave = vi.fn()
    openShortcuts(onSave)
    record('add', { key: 'x', metaKey: true, shiftKey: true })
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

describe('SettingsModal key notation', () => {
  function openEditor(onSave: (p: Partial<Settings>) => void = () => {}) {
    render(
      <SettingsModal
        settings={settings}
        onClose={() => {}}
        onSave={onSave}
        onPreviewTheme={() => {}}
        onSettingsReplaced={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('settings-tab-editor'))
  }

  // Camelot is what most DJ tools sort by, so it's the default; musical names
  // remain a choice because classically-trained users read Am, not 8A. The
  // setting drives which notation the key suggestion chip offers.
  it('defaults to Camelot and saves the musical notation when chosen', () => {
    const onSave = vi.fn()
    openEditor(onSave)
    expect(screen.getByTestId('settings-key-notation-camelot')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.click(screen.getByTestId('settings-key-notation-musical'))
    fireEvent.click(screen.getByTestId('settings-save'))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ keyNotation: 'musical' }))
  })
})

describe('SettingsModal settings folder', () => {
  // Moving the settings folder is how preferences sync across Macs (point it at
  // iCloud Drive/Dropbox). It applies immediately — no Save step — and the staged
  // synced fields refresh from the adopted folder so a later Save can't clobber
  // another machine's prefs with this modal's stale copies.
  it('applies the picked folder immediately and refreshes synced prefs', async () => {
    const api = window.api as unknown as Record<string, unknown>
    api.getConfigDir = vi.fn(async () => null)
    api.pickConfigDir = vi.fn(async () => '/iCloud/Surco')
    api.setConfigDir = vi.fn(async () => ({ ...settings, keyNotation: 'musical' }))
    const onSettingsReplaced = vi.fn()
    const onSave = vi.fn()
    render(
      <SettingsModal
        settings={settings}
        onClose={() => {}}
        onSave={onSave}
        onPreviewTheme={() => {}}
        onSettingsReplaced={onSettingsReplaced}
      />,
    )
    fireEvent.click(screen.getByTestId('settings-config-dir-change'))
    expect(await screen.findByDisplayValue('/iCloud/Surco')).toBeInTheDocument()
    expect(api.setConfigDir).toHaveBeenCalledWith('/iCloud/Surco')
    expect(onSettingsReplaced).toHaveBeenCalledWith(
      expect.objectContaining({ keyNotation: 'musical' }),
    )
    fireEvent.click(screen.getByTestId('settings-save'))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ keyNotation: 'musical' }))
  })

  it('offers a reset back to the default folder only when a custom one is set', async () => {
    const api = window.api as unknown as Record<string, unknown>
    api.getConfigDir = vi.fn(async () => '/iCloud/Surco')
    api.setConfigDir = vi.fn(async () => settings)
    render(
      <SettingsModal
        settings={settings}
        onClose={() => {}}
        onSave={() => {}}
        onPreviewTheme={() => {}}
        onSettingsReplaced={() => {}}
      />,
    )
    expect(await screen.findByDisplayValue('/iCloud/Surco')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('settings-config-dir-reset'))
    expect(api.setConfigDir).toHaveBeenCalledWith(null)
    expect(await screen.findByTestId('settings-config-dir')).not.toHaveValue('/iCloud/Surco')
    expect(screen.queryByTestId('settings-config-dir-reset')).not.toBeInTheDocument()
  })
})

describe('SettingsModal analysis cache', () => {
  // The clear button must actually wipe the cache and then show the now-empty size,
  // so the user sees their click took effect rather than a stale figure.
  it('empties the cache and refreshes the shown size', async () => {
    const api = window.api as unknown as Record<string, unknown>
    const clearCache = vi.fn(async () => {})
    api.clearCache = clearCache
    api.cacheStats = vi
      .fn()
      .mockResolvedValueOnce({ files: 12, bytes: 3_400_000 })
      .mockResolvedValue({ files: 0, bytes: 0 })
    render(
      <SettingsModal
        settings={settings}
        onClose={() => {}}
        onSave={() => {}}
        onPreviewTheme={() => {}}
        onSettingsReplaced={() => {}}
      />,
    )
    expect(await screen.findByDisplayValue('12 · 3.2 MB')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('settings-cache-clear'))
    expect(clearCache).toHaveBeenCalledTimes(1)
    expect(await screen.findByDisplayValue('0 · 0 B')).toBeInTheDocument()
  })

  // An empty cache has nothing to clear, so the button is disabled — clicking it
  // would be a no-op that misleads the user into thinking something happened.
  it('disables the clear button when nothing is cached', async () => {
    const api = window.api as unknown as Record<string, unknown>
    api.cacheStats = vi.fn(async () => ({ files: 0, bytes: 0 }))
    render(
      <SettingsModal
        settings={settings}
        onClose={() => {}}
        onSave={() => {}}
        onPreviewTheme={() => {}}
        onSettingsReplaced={() => {}}
      />,
    )
    expect(await screen.findByTestId('settings-cache-clear')).toBeDisabled()
  })
})
