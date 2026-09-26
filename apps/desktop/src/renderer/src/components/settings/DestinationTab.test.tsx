// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_EDITOR_SECTIONS } from '../../../../shared/editorSections'
import i18n from '../../i18n'

// DestinationTab reads window.api.platform at module scope (isMacOS), so the bridge
// must exist before the module loads — hence the dynamic import below.
import type { LocalDraft, SyncedDraft } from '../../lib/settingsDraft'
import type { PatchSynced } from '../../lib/settingsTabs'
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
  backupPolicy: 'always',
  backupRetentionDays: 30,
  backupMaxGb: 10,
  addToEngineDj: false,
  syncTraktor: false,
  syncRekordbox: false,
  engineDjPlaylist: 'Surco',
  filenameFormat: '{artist} - {title}',
  titleFormat: '',
  autoApplyFilename: false,
  grouping: '',
  genre: '',
  genreSeparator: ', ',
  groupingSeparator: ', ',
  trimWhitespace: true,
  zeroPadTrack: true,
  fullReleaseDate: false,
  visibleFields: [],
  customFields: [],
  importFields: [],
  requiredFields: [],
  coverMaxSize: '1200',
  traktorCueOffsetMs: '0',
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
  rekordboxDbPath: '',
  betaUpdates: false,
  autoMatch: false,
  beatportUsername: '',
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
      rekordboxCollection=""
      onChangeRekordboxDbPath={vi.fn()}
    />,
  )
  return patch
}

// The cue offset only does anything with a collection set, so every test of it renders
// the tab already pointed at one.
function renderWithCollection(patch: PatchSynced, offset = '0'): void {
  render(
    <DestinationTab
      synced={{ ...synced, traktorCueOffsetMs: offset }}
      local={{ ...local, traktorNmlPath: '/dj/collection.nml' }}
      patch={patch}
      onOutputDirChange={vi.fn()}
      onChangeEngineDir={vi.fn()}
      onChangeTraktorNmlPath={vi.fn()}
      detectedNmlPath={null}
      onAcceptDetectedNmlPath={vi.fn()}
      rekordboxCollection=""
      onChangeRekordboxDbPath={vi.fn()}
    />,
  )
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
    expect(screen.getByTestId('settings-output')).toHaveTextContent('/out')
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
    expect(screen.getByTestId('settings-engine-library')).toHaveTextContent('/music/Engine Library')
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
    // An empty box says nothing about what it wants; with no collection set the field
    // says so in words instead of sitting blank next to a floating button.
    expect(screen.getByTestId('settings-traktor-nml')).toHaveTextContent(
      i18n.t('settings.traktorNmlPathEmpty'),
    )
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
        rekordboxCollection=""
        onChangeRekordboxDbPath={vi.fn()}
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
        rekordboxCollection=""
        onChangeRekordboxDbPath={vi.fn()}
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
        rekordboxCollection=""
        onChangeRekordboxDbPath={vi.fn()}
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
        rekordboxCollection=""
        onChangeRekordboxDbPath={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('settings-traktor-nml-use-detected'))
    expect(onAcceptDetectedNmlPath).toHaveBeenCalled()
  })

  // Reported 09/09/2026: "look into being able to turn off loading the nml, because
  // there's no way to leave it empty — I have to point it at another path to test".
  // The hint says "leave it empty to turn this off" and the tab offered only Change,
  // which opens a file picker: the one promise the UI could not keep, and the only way
  it('turns the Traktor sync on and off with its own toggle', () => {
    const patch = vi.fn()
    render(
      <DestinationTab
        synced={{ ...synced, syncTraktor: false }}
        local={{ ...local, traktorNmlPath: '/dj/collection.nml' }}
        patch={patch}
        onOutputDirChange={vi.fn()}
        onChangeEngineDir={vi.fn()}
        onChangeTraktorNmlPath={vi.fn()}
        detectedNmlPath={null}
        onAcceptDetectedNmlPath={vi.fn()}
        rekordboxCollection=""
        onChangeRekordboxDbPath={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByTestId('settings-sync-traktor'))
    expect(patch).toHaveBeenCalledWith('syncTraktor', true)
  })

  // Visible but disabled, never absent: a control that disappears leaves the user unsure
  // the feature exists at all. Dimmed says both that it is there and that something is
  // still missing, and the hint below names what.
  it('shows the Traktor toggle disabled while no collection is set', () => {
    render(
      <DestinationTab
        synced={{ ...synced, syncTraktor: false }}
        local={{ ...local, traktorNmlPath: '' }}
        patch={vi.fn()}
        onOutputDirChange={vi.fn()}
        onChangeEngineDir={vi.fn()}
        onChangeTraktorNmlPath={vi.fn()}
        detectedNmlPath={null}
        onAcceptDetectedNmlPath={vi.fn()}
        rekordboxCollection=""
        onChangeRekordboxDbPath={vi.fn()}
      />,
    )

    expect(screen.getByTestId('settings-sync-traktor')).toBeDisabled()
  })

  // rekordbox keeps its collection in one place per platform, so unlike Traktor there is
  // nothing to point at: the toggle is the whole setup.
  it('turns the rekordbox sync on with its own toggle', () => {
    const patch = vi.fn()
    render(
      <DestinationTab
        synced={{ ...synced, syncRekordbox: false }}
        local={local}
        patch={patch}
        onOutputDirChange={vi.fn()}
        onChangeEngineDir={vi.fn()}
        onChangeTraktorNmlPath={vi.fn()}
        detectedNmlPath={null}
        onAcceptDetectedNmlPath={vi.fn()}
        rekordboxCollection="/Users/dj/Library/Pioneer/rekordbox/master.db"
        onChangeRekordboxDbPath={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByTestId('settings-sync-rekordbox'))
    expect(patch).toHaveBeenCalledWith('syncRekordbox', true)
  })

  // Someone who does not run rekordbox still sees the setting, dimmed, with the hint
  // saying no collection was found — rather than wondering whether Surco supports it.
  it('shows the rekordbox toggle disabled when no collection was found', () => {
    render(
      <DestinationTab
        synced={{ ...synced, syncRekordbox: false }}
        local={local}
        patch={vi.fn()}
        onOutputDirChange={vi.fn()}
        onChangeEngineDir={vi.fn()}
        onChangeTraktorNmlPath={vi.fn()}
        detectedNmlPath={null}
        onAcceptDetectedNmlPath={vi.fn()}
        rekordboxCollection=""
        onChangeRekordboxDbPath={vi.fn()}
      />,
    )

    expect(screen.getByTestId('settings-sync-rekordbox')).toBeDisabled()
  })

  // A collection outside rekordbox's usual place was undetected AND unpickable: the field
  // only appeared once one was found. It is always there now, so it can be pointed at.
  it('offers the rekordbox collection picker even when none was found', () => {
    const onChangeRekordboxDbPath = vi.fn()
    render(
      <DestinationTab
        synced={synced}
        local={local}
        patch={vi.fn()}
        onOutputDirChange={vi.fn()}
        onChangeEngineDir={vi.fn()}
        onChangeTraktorNmlPath={vi.fn()}
        detectedNmlPath={null}
        onAcceptDetectedNmlPath={vi.fn()}
        rekordboxCollection=""
        onChangeRekordboxDbPath={onChangeRekordboxDbPath}
      />,
    )
    expect(screen.getByTestId('settings-rekordbox-db')).toHaveTextContent(
      i18n.t('settings.traktorNmlPathEmpty'),
    )
    fireEvent.click(screen.getByTestId('settings-rekordbox-db-change'))
    expect(onChangeRekordboxDbPath).toHaveBeenCalled()
  })

  // Nothing configured means nothing to clear, and a live button that does nothing reads
  it('keeps the cue offset usable with no collection configured', () => {
    render(
      <DestinationTab
        synced={synced}
        local={local}
        patch={vi.fn()}
        onOutputDirChange={vi.fn()}
        onChangeEngineDir={vi.fn()}
        onChangeTraktorNmlPath={vi.fn()}
        detectedNmlPath={null}
        onAcceptDetectedNmlPath={vi.fn()}
        rekordboxCollection=""
        onChangeRekordboxDbPath={vi.fn()}
      />,
    )
    expect(screen.getByTestId('settings-cue-dir-early')).toBeEnabled()
    cleanup()
    render(
      <DestinationTab
        synced={synced}
        local={{ ...local, traktorNmlPath: '/dj/collection.nml' }}
        patch={vi.fn()}
        onOutputDirChange={vi.fn()}
        onChangeEngineDir={vi.fn()}
        onChangeTraktorNmlPath={vi.fn()}
        detectedNmlPath={null}
        onAcceptDetectedNmlPath={vi.fn()}
        rekordboxCollection=""
        onChangeRekordboxDbPath={vi.fn()}
      />,
    )
    expect(screen.getByTestId('settings-cue-dir-early')).toBeEnabled()
  })

  // Reported from a screenshot: focusing the path box scrolls the text sideways to put
  // the caret at the end, so the start of the path — the part that says which collection
  // this is — slides out of view, on top of the truncation already clipping the end.
  // Nothing can be typed here anyway (the value only changes through "Change"), so the
  // box does not take keyboard focus and the text stays where it was rendered.
  it('keeps the collection path from scrolling out of view', () => {
    render(
      <DestinationTab
        synced={synced}
        local={{
          ...local,
          traktorNmlPath: '/Users/dj/Documents/Native Instruments/Traktor 4.5.0/collection.nml',
        }}
        patch={vi.fn()}
        onOutputDirChange={vi.fn()}
        onChangeEngineDir={vi.fn()}
        onChangeTraktorNmlPath={vi.fn()}
        detectedNmlPath={null}
        onAcceptDetectedNmlPath={vi.fn()}
        rekordboxCollection=""
        onChangeRekordboxDbPath={vi.fn()}
      />,
    )
    const field = screen.getByTestId('settings-traktor-nml')
    // tabIndex alone did not fix this: it stops tabbing, not clicking, and clicking is
    // what the user does. Only a non-input element can't take a caret at all.
    expect(field.tagName).not.toBe('INPUT')
    field.focus()
    expect(document.activeElement).not.toBe(field)
    // The path still has to be readable, in full, without a caret.
    expect(field).toHaveTextContent('collection.nml')
    expect(field).toHaveAttribute('title', expect.stringContaining('/Users/dj/Documents'))
  })

  // The signed row asked the DJ to know, in advance, which way a sign moves a cue. He
  // did not: "you put it the other way round" (09/09/2026), after a session of
  // converting and listening. So the direction is a question in his own words and the
  // amount is always positive — the sign becomes something Surco computes, never
  // something he has to reason about. The stored value is still one signed number, so
  // nothing downstream changes.
  // Measured end to end (cueOffsetDirection.test.ts): a NEGATIVE offset takes a cue from
  // 10000 ms to 9949, nearer the start, so it fires EARLIER. Cues that already come in
  // early therefore need the POSITIVE sign to push them later. This inversion is the
  // whole reason the DJ never sees a sign, and it is pinned here so nobody "fixes" the
  // mapping to match first instinct.
  it('pushes cues later when the DJ says they come in early', () => {
    const patch = vi.fn<PatchSynced>()
    renderWithCollection(patch, '0')

    fireEvent.click(screen.getByTestId('settings-cue-dir-early'))

    expect(patch).toHaveBeenCalledWith('traktorCueOffsetMs', '51')
  })

  it('pulls cues earlier when the DJ says they come in late', () => {
    const patch = vi.fn<PatchSynced>()
    renderWithCollection(patch, '0')

    fireEvent.click(screen.getByTestId('settings-cue-dir-late'))

    expect(patch).toHaveBeenCalledWith('traktorCueOffsetMs', '-51')
  })

  // The way back to "leave them alone" is the first choice, where a DJ who tried an
  // adjustment and found it wrong will look for it.
  it('clears the offset from the first choice', () => {
    const patch = vi.fn<PatchSynced>()
    renderWithCollection(patch, '-51')

    fireEvent.click(screen.getByTestId('settings-cue-dir-none'))

    expect(patch).toHaveBeenCalledWith('traktorCueOffsetMs', '0')
  })

  // Which choice reads as selected follows the stored value, so reopening Settings shows
  // the state the conversion will actually use rather than a reset default.
  it('selects the choice matching the stored sign', () => {
    renderWithCollection(vi.fn<PatchSynced>(), '-51')

    expect(screen.getByTestId('settings-cue-dir-late')).toBeChecked()
    expect(screen.getByTestId('settings-cue-dir-none')).not.toBeChecked()
    expect(screen.getByTestId('settings-cue-dir-early')).not.toBeChecked()
  })

  it('selects the early choice for a positive value', () => {
    renderWithCollection(vi.fn<PatchSynced>(), '25')

    expect(screen.getByTestId('settings-cue-dir-early')).toBeChecked()
  })

  // Always the magnitude, never the stored sign: showing "-51" beside a choice that
  // already says "early" is the double negative this redesign exists to remove.
  it('shows the amount unsigned whichever direction is chosen', () => {
    renderWithCollection(vi.fn<PatchSynced>(), '-51')

    expect(screen.getByTestId('settings-cue-amount')).toHaveTextContent('51 ms')
    expect(screen.getByTestId('settings-cue-amount')).not.toHaveTextContent('-')
  })

  // The reporter arrived at 51 by ear over a long session, so every value has to stay
  // reachable. Stepping keeps the direction already chosen rather than re-deriving it.
  it('steps the amount up while keeping the chosen direction', () => {
    const patch = vi.fn<PatchSynced>()
    renderWithCollection(patch, '-51')

    fireEvent.click(screen.getByTestId('settings-cue-amount-up'))

    expect(patch).toHaveBeenCalledWith('traktorCueOffsetMs', '-52')
  })

  it('steps the amount down while keeping the chosen direction', () => {
    const patch = vi.fn<PatchSynced>()
    renderWithCollection(patch, '51')

    fireEvent.click(screen.getByTestId('settings-cue-amount-down'))

    expect(patch).toHaveBeenCalledWith('traktorCueOffsetMs', '50')
  })

  // Stepping while nothing is being corrected has no direction to preserve, so the
  // amount is inert until a direction is chosen rather than silently picking one.
  it('does not step the amount while no correction is chosen', () => {
    const patch = vi.fn<PatchSynced>()
    renderWithCollection(patch, '0')

    expect(screen.getByTestId('settings-cue-amount-up')).toBeDisabled()
    expect(screen.getByTestId('settings-cue-amount-down')).toBeDisabled()
  })

  // The amount cannot cross zero by stepping: that would flip the direction under a DJ
  // who was only trying to make the correction smaller, contradicting the choice above.
  it('will not step below one millisecond', () => {
    const patch = vi.fn<PatchSynced>()
    renderWithCollection(patch, '-1')

    fireEvent.click(screen.getByTestId('settings-cue-amount-down'))

    expect(patch).not.toHaveBeenCalled()
  })

  // The collection path gates what Traktor is told about tracks it ALREADY holds — their
  // cues and their metadata. It does not gate the cues written into the converted file,
  // which is what this offset moves, so the controls stay usable without one.
  it('keeps the choices usable while no collection is configured', () => {
    render(
      <DestinationTab
        synced={synced}
        local={local}
        patch={vi.fn()}
        onOutputDirChange={vi.fn()}
        onChangeEngineDir={vi.fn()}
        onChangeTraktorNmlPath={vi.fn()}
        detectedNmlPath={null}
        onAcceptDetectedNmlPath={vi.fn()}
        rekordboxCollection=""
        onChangeRekordboxDbPath={vi.fn()}
      />,
    )

    expect(screen.getByTestId('settings-cue-dir-early')).toBeEnabled()
  })

  // The other half of the same correction: not merely enabled to look at, but actually
  // staging the value. The reporter's whole complaint was that he could not leave his
  // 51 set without pointing Surco at a collection he did not need for converting.
  it('stages a direction picked with no collection set', () => {
    const patch = vi.fn<PatchSynced>()
    render(
      <DestinationTab
        synced={synced}
        local={local}
        patch={patch}
        onOutputDirChange={vi.fn()}
        onChangeEngineDir={vi.fn()}
        onChangeTraktorNmlPath={vi.fn()}
        detectedNmlPath={null}
        onAcceptDetectedNmlPath={vi.fn()}
        rekordboxCollection=""
        onChangeRekordboxDbPath={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByTestId('settings-cue-dir-early'))

    expect(patch).toHaveBeenCalledWith('traktorCueOffsetMs', '51')
  })

  // The hint is the only prose left, so it carries what the controls cannot: that the
  // normal state is no adjustment because the codec correction is automatic, the loop
  // nobody can shortcut, and what the adjustment does NOT touch — a DJ whose loops
  // changed length would never trust it again.
  it('says the normal case is no adjustment and what it leaves alone', () => {
    renderWithCollection(vi.fn<PatchSynced>(), '-51')

    const hint = screen.getByText(i18n.t('settings.traktorCueOffsetHint'))
    expect(hint.textContent).toMatch(/automatically|already corrects|no adjustment/i)
    expect(hint.textContent).toMatch(/listen|hear/i)
    expect(hint.textContent).toMatch(/loops/i)
  })
})

describe('DestinationTab originals', () => {
  // The setting used to hang off the overwrite radio, so it was invisible — and
  // inapplicable — under every other destination. But Originals also fills from a format
  // change and from a delete on a volume with no OS Trash, neither of which is the
  // overwrite destination, so the section stands on its own and is always reachable.
  it('shows the originals section whatever the destination is', () => {
    renderTab({ addToAppleMusic: true, overwriteOriginal: false })
    expect(screen.getByTestId('settings-backup-always')).toBeInTheDocument()
    expect(screen.getByTestId('settings-backup-days')).toBeInTheDocument()
    expect(screen.getByTestId('settings-backup-gb')).toBeInTheDocument()
  })

  it('stages the chosen level', () => {
    const patch = renderTab()
    fireEvent.click(screen.getByTestId('settings-backup-audioChanges'))
    expect(patch).toHaveBeenCalledWith('backupPolicy', 'audioChanges')
  })

  // The limits are number inputs inside the settings <form>, and the form is what Save
  // submits. A field the browser considers invalid blocks that submit silently: with
  // min=0.1 and step=0.5, the shipped default of 10 GB was not a valid step, so Save did
  // nothing at all — on a field the user had never touched. Asserted on the defaults
  // because that is the state every user starts in.
  it('leaves the limit fields valid at their defaults, so Save can submit', () => {
    renderTab()
    const days = screen.getByTestId('settings-backup-days') as HTMLInputElement
    const gb = screen.getByTestId('settings-backup-gb') as HTMLInputElement
    expect(days.checkValidity()).toBe(true)
    expect(gb.checkValidity()).toBe(true)
  })

  it('stages the limits as the user types them', () => {
    const patch = renderTab()
    fireEvent.change(screen.getByTestId('settings-backup-days'), { target: { value: '7' } })
    expect(patch).toHaveBeenCalledWith('backupRetentionDays', 7)
    fireEvent.change(screen.getByTestId('settings-backup-gb'), { target: { value: '25' } })
    expect(patch).toHaveBeenCalledWith('backupMaxGb', 25)
  })

  // Turning the net off is the one choice here that can cost a file, and with Never it
  // reaches a delete on a NAS too — where nothing else would have kept a copy. The
  // warning has to say that before the user picks it, not after.
  it('warns about losing files only while the backup is off', () => {
    renderTab({ backupPolicy: 'never' })
    const warning = screen.getByTestId('settings-backup-warning')
    expect(warning.textContent).toMatch(/trash/i)
    cleanup()
    renderTab({ backupPolicy: 'audioChanges' })
    expect(screen.queryByTestId('settings-backup-warning')).not.toBeInTheDocument()
  })

  // Settings' rule: a control that does not apply stays visible and disabled. The limits
  // still govern what is already stored, so they are dimmed rather than removed — and
  // switching the feature off must never look like it discarded the existing copies.
  it('disables the limits under never without hiding them', () => {
    renderTab({ backupPolicy: 'never' })
    expect(screen.getByTestId('settings-backup-days')).toBeDisabled()
    expect(screen.getByTestId('settings-backup-gb')).toBeDisabled()
  })

  it('explains the level in force', () => {
    renderTab({ backupPolicy: 'always' })
    expect(screen.getByTestId('settings-backup-hint')).toHaveTextContent(
      i18n.t('settings.originalBackupAlwaysHint'),
    )
    cleanup()
    renderTab({ backupPolicy: 'audioChanges' })
    expect(screen.getByTestId('settings-backup-hint')).toHaveTextContent(
      i18n.t('settings.originalBackupAudioChangesHint'),
    )
  })
})
