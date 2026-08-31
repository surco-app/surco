// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_EDITOR_SECTIONS } from '../../../../shared/editorSections'
import i18n from '../../i18n'

// DestinationTab reads window.api.platform at module scope (isMacOS), so the bridge
// must exist before the module loads — hence the dynamic import below.
import type { LocalDraft, SyncedDraft } from '../../lib/settingsDraft'
;(window as unknown as { api: unknown }).api = { platform: 'darwin' }
const { DestinationTab } = await import('./DestinationTab')

afterEach(cleanup)

const synced: SyncedDraft = {
  theme: 'system',
  language: 'system',
  outputFormat: 'aiff',
  keepMp3Sources: false,
  addToAppleMusic: false,
  keepOutputCopy: true,
  overwriteOriginal: false,
  convertBesideOriginal: false,
  addToEngineDj: false,
  engineDjPlaylist: 'Surco',
  filenameFormat: '{artist} - {title}',
  titleFormat: '',
  autoApplyFilename: false,
  grouping: '',
  genre: '',
  trimWhitespace: true,
  zeroPadTrack: true,
  visibleFields: [],
  importFields: [],
  requiredFields: [],
  coverMaxSize: '1200',
  coverSquare: false,
  coverUpscale: false,
  replaceLowResCover: false,
  flacFinderCovers: false,
  mp3Quality: '320',
  outputBitDepth: 'source',
  outputSampleRate: 'source',
  flacCompression: '5',
  showSpectrum: true,
  showLoudness: true,
  showEditorHints: true,
  autoAnalyze: false,
  keyNotation: 'camelot',
  normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
  declick: 'off',
  shortcutOverrides: {},
  editorSections: DEFAULT_EDITOR_SECTIONS,
  discogsFormats: [],
  discogsMaxResults: 10,
  searchProviders: ['discogs'],
  searchIgnoreWords: '',
}

const local: LocalDraft = {
  token: '',
  outputDir: '/out',
  engineLibraryDir: '/music/Engine Library',
  traktorNmlPath: '',
  autoMatch: false,
}

function renderTab(over: Partial<SyncedDraft> = {}, localOver: Partial<LocalDraft> = {}) {
  const patch = vi.fn()
  render(
    <DestinationTab
      synced={{ ...synced, ...over }}
      local={{ ...local, ...localOver }}
      patch={patch}
      onOutputDirChange={vi.fn()}
      onChangeEngineDir={vi.fn()}
      onChangeTraktorNmlPath={vi.fn()}
      detectedNmlPath={null}
      onAcceptDetectedNmlPath={vi.fn()}
    />,
  )
  return patch
}

describe('DestinationTab FLAC restriction', () => {
  // ALAC exists as a target precisely because Music ingests it — unlike FLAC it must
  // not pin the destination to the output folder. The format is chosen on the
  // Conversion tab, but its consequence surfaces here, next to the pinned radio.
  it('shows the Apple Music note only while FLAC is the format', () => {
    renderTab({ outputFormat: 'flac' })
    expect(screen.getByText(/Apple Music can't play FLAC/)).toBeInTheDocument()
    cleanup()
    renderTab({ outputFormat: 'alac' })
    expect(screen.queryByText(/Apple Music can't play FLAC/)).not.toBeInTheDocument()
  })
})

describe('DestinationTab Engine DJ destination', () => {
  // Choosing Engine DJ must clear the other destinations in the same patch batch —
  // a leftover addToAppleMusic or overwriteOriginal would make the radio show one
  // thing and the conversion do another.
  it('stages Engine DJ as an exclusive destination choice', () => {
    const patch = renderTab()
    fireEvent.click(screen.getByTestId('settings-destination-engineDj'))
    expect(patch).toHaveBeenCalledWith('addToEngineDj', true)
    expect(patch).toHaveBeenCalledWith('addToAppleMusic', false)
    expect(patch).toHaveBeenCalledWith('keepOutputCopy', true)
    expect(patch).toHaveBeenCalledWith('overwriteOriginal', false)
  })

  // "Next to the original" is the non-destructive sibling of overwrite: a fresh copy
  // beside the source, nothing in any library — one radio choice like the rest, so a
  // leftover boolean can't make the radio show one thing and the conversion do another.
  it('stages beside-the-original as an exclusive destination choice', () => {
    const patch = renderTab()
    fireEvent.click(screen.getByTestId('settings-destination-beside'))
    expect(patch).toHaveBeenCalledWith('convertBesideOriginal', true)
    expect(patch).toHaveBeenCalledWith('overwriteOriginal', false)
    expect(patch).toHaveBeenCalledWith('addToAppleMusic', false)
    expect(patch).toHaveBeenCalledWith('addToEngineDj', false)
  })

  // Like Engine DJ, a fresh copy beside the source is FLAC-proof, so the FLAC pin
  // that greys Apple Music out must not touch it.
  it('keeps beside-the-original selectable while FLAC is the format', () => {
    renderTab({ outputFormat: 'flac' })
    expect(screen.getByTestId('settings-destination-beside')).toBeEnabled()
  })

  // A greyed-out Apple Music radio alone doesn't say WHY; the note names the FLAC
  // limitation, and only while FLAC is the format — the rest of the time it would
  // just be noise under the picker.
  it('explains the Apple Music FLAC limitation only while FLAC is the format', () => {
    renderTab({ outputFormat: 'flac' })
    expect(screen.getByText(i18n.t('settings.appleMusicFlacNote'))).toBeInTheDocument()
    cleanup()
    renderTab()
    expect(screen.queryByText(i18n.t('settings.appleMusicFlacNote'))).toBeNull()
  })

  // The output folder is a detail OF the "Output folder" choice, so it lives under
  // that radio — floating above the group it read as an unrelated global path, and
  // under Apple Music or overwrite (no folder copy) it would just mislead.
  it('shows the output folder under its radio only while it is the destination', () => {
    renderTab()
    expect(screen.getByTestId('settings-output')).toHaveValue('/out')
    expect(screen.getByTestId('settings-output').closest('[inert]')).toBeNull()
    cleanup()
    // Kept mounted so the collapse can animate out; inert is what "hidden" means —
    // no focus stop, no interaction — while the height/opacity transition runs.
    renderTab({ addToEngineDj: true })
    expect(screen.getByTestId('settings-output').closest('[inert]')).not.toBeNull()
  })

  // The library folder only matters once conversions are actually registered there;
  // showing it under every destination would read as an unrelated global path.
  it('shows the Engine library folder under its radio only while Engine DJ is the destination', () => {
    renderTab()
    expect(screen.getByTestId('settings-engine-library').closest('[inert]')).not.toBeNull()
    cleanup()
    renderTab({ addToEngineDj: true })
    expect(screen.getByTestId('settings-engine-library')).toHaveValue('/music/Engine Library')
    expect(screen.getByTestId('settings-engine-library').closest('[inert]')).toBeNull()
  })

  // Engine DJ plays FLAC natively, so the FLAC restriction that pins Apple Music to
  // the folder must not grey this option out.
  it('keeps Engine DJ selectable while FLAC is the format', () => {
    renderTab({ outputFormat: 'flac' })
    expect(screen.getByTestId('settings-destination-engineDj')).toBeEnabled()
    expect(screen.getByTestId('settings-destination-appleMusic')).toBeDisabled()
  })

  // The playlist is where the DJ finds what Surco converted, so it belongs with the
  // destination — editable, seeded from the setting, staged through the draft patch.
  it('shows the editable playlist field only while Engine DJ is the destination', () => {
    renderTab()
    expect(screen.getByTestId('settings-engine-playlist').closest('[inert]')).not.toBeNull()
    cleanup()
    const patch = renderTab({ addToEngineDj: true })
    const field = screen.getByTestId('settings-engine-playlist')
    expect(field).toHaveValue('Surco')
    fireEvent.change(field, { target: { value: 'Pool' } })
    expect(patch).toHaveBeenCalledWith('engineDjPlaylist', 'Pool')
  })
})

describe('DestinationTab Traktor collection', () => {
  // Traktor cue sync is a side effect of conversion, not a destination the file goes
  // to — it must stay visible whatever radio is selected, unlike Engine DJ's fields.
  it('always shows the collection.nml field regardless of the chosen destination', () => {
    renderTab()
    expect(screen.getByTestId('settings-traktor-nml').closest('[inert]')).toBeNull()
    expect(screen.getByTestId('settings-traktor-nml')).toHaveValue('')
  })

  it('opens the file picker when Change is clicked', () => {
    const onChangeTraktorNmlPath = vi.fn()
    render(
      <DestinationTab
        synced={synced}
        local={local}
        patch={vi.fn()}
        onOutputDirChange={vi.fn()}
        onChangeEngineDir={vi.fn()}
        onChangeTraktorNmlPath={onChangeTraktorNmlPath}
        detectedNmlPath={null}
        onAcceptDetectedNmlPath={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('settings-traktor-nml-change'))
    expect(onChangeTraktorNmlPath).toHaveBeenCalled()
  })

  // Autodetection only proposes a candidate; it must never appear once a path is
  // already set (staged or saved), so a returning user doesn't see it resurface.
  it('offers a detected path to accept only while no path is set yet', () => {
    renderTab({}, {})
    render(
      <DestinationTab
        synced={synced}
        local={local}
        patch={vi.fn()}
        onOutputDirChange={vi.fn()}
        onChangeEngineDir={vi.fn()}
        onChangeTraktorNmlPath={vi.fn()}
        detectedNmlPath="/Users/dj/Documents/Native Instruments/Traktor 4.5.0/collection.nml"
        onAcceptDetectedNmlPath={vi.fn()}
      />,
    )
    expect(screen.getByTestId('settings-traktor-nml-detected')).toBeInTheDocument()
    cleanup()
    render(
      <DestinationTab
        synced={synced}
        local={{ ...local, traktorNmlPath: '/already/set/collection.nml' }}
        patch={vi.fn()}
        onOutputDirChange={vi.fn()}
        onChangeEngineDir={vi.fn()}
        onChangeTraktorNmlPath={vi.fn()}
        detectedNmlPath="/Users/dj/Documents/Native Instruments/Traktor 4.5.0/collection.nml"
        onAcceptDetectedNmlPath={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('settings-traktor-nml-detected')).not.toBeInTheDocument()
  })

  // Accepting the proposal is the only way it ever reaches the draft — clicking
  // "Use this" must call back into the modal rather than writing the path itself.
  it('stages the detected path only when the user accepts it', () => {
    const onAcceptDetectedNmlPath = vi.fn()
    render(
      <DestinationTab
        synced={synced}
        local={local}
        patch={vi.fn()}
        onOutputDirChange={vi.fn()}
        onChangeEngineDir={vi.fn()}
        onChangeTraktorNmlPath={vi.fn()}
        detectedNmlPath="/Users/dj/Documents/Native Instruments/Traktor 4.5.0/collection.nml"
        onAcceptDetectedNmlPath={onAcceptDetectedNmlPath}
      />,
    )
    fireEvent.click(screen.getByTestId('settings-traktor-nml-use-detected'))
    expect(onAcceptDetectedNmlPath).toHaveBeenCalled()
  })
})
