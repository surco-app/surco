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
  trimWhitespace: true,
  zeroPadTrack: true,
  visibleFields: [],
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

const OLD_RADIO: Record<string, Partial<SyncedDraft>> = {
  folder: { addToAppleMusic: false, keepOutputCopy: true },
  appleMusic: { addToAppleMusic: true, keepOutputCopy: false },
  engineDj: { addToEngineDj: true, keepOutputCopy: true },
  beside: { convertBesideOriginal: true },
  overwrite: { overwriteOriginal: true },
}

function checkedIds(prefix: string): string[] {
  return screen
    .getAllByTestId(new RegExp(`^${prefix}-`))
    .filter((el) => (el as HTMLInputElement).checked)
    .map((el) => el.getAttribute('data-testid') ?? '')
}

describe('DestinationTab two questions', () => {
  it('asks what the DJ plays with before where the file is saved', () => {
    renderTab()
    const dj = screen.getByTestId('settings-dj-engineDj')
    const location = screen.getByTestId('settings-location-folder')
    expect(dj.compareDocumentPosition(location) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each([
    ['folder', 'settings-location-folder', []],
    ['appleMusic', 'settings-location-folder', ['settings-dj-appleMusic']],
    ['engineDj', 'settings-location-folder', ['settings-dj-engineDj']],
    ['beside', 'settings-location-beside', []],
    ['overwrite', 'settings-location-overwrite', []],
  ])('renders an old %s destination as the same location and DJ software', (old, location, dj) => {
    renderTab(OLD_RADIO[old])
    expect(checkedIds('settings-location')).toEqual([location])
    expect(checkedIds('settings-dj')).toEqual(dj)
  })

  it('keeps no folder copy for an old Apple Music destination', () => {
    renderTab(OLD_RADIO.appleMusic)
    expect(screen.getByTestId('settings-apple-music-copy')).not.toBeChecked()
    expect(screen.getByTestId('settings-apple-music-copy')).toBeEnabled()
  })

  it('stages Apple Music without a folder copy, as choosing it always meant', () => {
    const patch = renderTab()
    fireEvent.click(screen.getByTestId('settings-dj-appleMusic'))
    expect(patch).toHaveBeenCalledWith('addToAppleMusic', true)
    expect(patch).toHaveBeenCalledWith('keepOutputCopy', false)
    expect(patch).toHaveBeenCalledWith('overwriteOriginal', false)
    expect(patch).toHaveBeenCalledWith('convertBesideOriginal', false)
  })

  it('lets Apple Music keep a folder copy when asked', () => {
    const patch = renderTab(OLD_RADIO.appleMusic)
    fireEvent.click(screen.getByTestId('settings-apple-music-copy'))
    expect(patch).toHaveBeenCalledWith('keepOutputCopy', true)
  })

  it('adds Engine DJ next to Apple Music instead of replacing it', () => {
    const patch = renderTab(OLD_RADIO.appleMusic)
    fireEvent.click(screen.getByTestId('settings-dj-engineDj'))
    expect(patch).toHaveBeenCalledWith('addToEngineDj', true)
    expect(patch).toHaveBeenCalledWith('addToAppleMusic', true)
  })

  it('shows the folder copy as kept and fixed while Engine DJ needs the file', () => {
    renderTab({ ...OLD_RADIO.appleMusic, addToEngineDj: true })
    expect(screen.getByTestId('settings-apple-music-copy')).toBeChecked()
    expect(screen.getByTestId('settings-apple-music-copy')).toBeDisabled()
    expect(screen.getByText(i18n.t('settings.appleMusicKeepCopyEngine'))).toBeInTheDocument()
  })

  it('leaves every library when saving beside the original', () => {
    const patch = renderTab({ ...OLD_RADIO.appleMusic, addToEngineDj: true })
    fireEvent.click(screen.getByTestId('settings-location-beside'))
    expect(patch).toHaveBeenCalledWith('convertBesideOriginal', true)
    expect(patch).toHaveBeenCalledWith('overwriteOriginal', false)
    expect(patch).toHaveBeenCalledWith('addToAppleMusic', false)
    expect(patch).toHaveBeenCalledWith('addToEngineDj', false)
  })

  it.each(['beside', 'overwrite'])(
    'disables Apple Music and Engine DJ with the reason while saving %s the original',
    (old) => {
      renderTab(OLD_RADIO[old])
      expect(screen.getByTestId('settings-dj-appleMusic')).toBeDisabled()
      expect(screen.getByTestId('settings-dj-engineDj')).toBeDisabled()
      expect(screen.getAllByText(i18n.t('settings.libraryNeedsFolder'))).toHaveLength(2)
    },
  )

  it.each(['beside', 'overwrite'])(
    'keeps the Traktor and rekordbox collections in step while saving %s the original',
    (old) => {
      render(
        <DestinationTab
          synced={{ ...synced, ...OLD_RADIO[old] }}
          local={{ ...local, traktorNmlPath: '/dj/collection.nml' }}
          patch={vi.fn()}
          onOutputDirChange={vi.fn()}
          onChangeEngineDir={vi.fn()}
          onChangeTraktorNmlPath={vi.fn()}
          detectedNmlPath={null}
          onAcceptDetectedNmlPath={vi.fn()}
          rekordboxCollection="/Users/dj/Library/Pioneer/rekordbox/master.db"
          onChangeRekordboxDbPath={vi.fn()}
        />,
      )
      expect(screen.getByTestId('settings-dj-traktor')).toBeEnabled()
      expect(screen.getByTestId('settings-dj-rekordbox')).toBeEnabled()
    },
  )

  it('keeps FLAC out of Apple Music with the reason, and Engine DJ and beside open', () => {
    renderTab({ ...OLD_RADIO.appleMusic, outputFormat: 'flac' })
    expect(screen.getByTestId('settings-dj-appleMusic')).toBeDisabled()
    expect(screen.getByTestId('settings-dj-appleMusic')).not.toBeChecked()
    expect(screen.getByText(i18n.t('settings.appleMusicFlacNote'))).toBeInTheDocument()
    expect(screen.getByTestId('settings-dj-engineDj')).toBeEnabled()
    expect(screen.getByTestId('settings-location-beside')).toBeEnabled()
    cleanup()
    renderTab({ outputFormat: 'alac' })
    expect(screen.queryByText(i18n.t('settings.appleMusicFlacNote'))).toBeNull()
  })

  it('keeps the output folder and Engine fields on screen whatever is chosen', () => {
    for (const old of Object.keys(OLD_RADIO)) {
      renderTab(OLD_RADIO[old])
      for (const id of ['settings-output', 'settings-engine-library', 'settings-engine-playlist']) {
        expect(screen.getByTestId(id)).toBeVisible()
        expect(screen.getByTestId(id).closest('[inert]')).toBeNull()
      }
      cleanup()
    }
  })

  it('stages the Engine playlist typed under its chip', () => {
    const patch = renderTab()
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

    fireEvent.click(screen.getByTestId('settings-dj-traktor'))
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

    expect(screen.getByTestId('settings-dj-traktor')).toBeDisabled()
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

    fireEvent.click(screen.getByTestId('settings-dj-rekordbox'))
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

    expect(screen.getByTestId('settings-dj-rekordbox')).toBeDisabled()
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

// Where the file goes and which DJ libraries hear about it are the everyday choices; how
// much of the originals is kept, the cue adjustment and a rekordbox collection outside
// its usual place are set once, if ever, so they fold under Advanced.
describe('DestinationTab advanced', () => {
  it('keeps destination and sync in view and folds the rarely touched details', () => {
    renderTab()
    for (const id of [
      'settings-location-folder',
      'settings-dj-traktor',
      'settings-traktor-nml',
      'settings-dj-rekordbox',
      'settings-backup-summary',
    ]) {
      expect(screen.getByTestId(id)).toBeVisible()
    }
    for (const id of [
      'settings-backup-always',
      'settings-backup-days',
      'settings-cue-dir-early',
      'settings-rekordbox-db',
    ]) {
      expect(screen.getByTestId(id)).not.toBeVisible()
    }
    fireEvent.click(screen.getByTestId('settings-advanced-destination'))
    expect(screen.getByTestId('settings-backup-days')).toBeVisible()
    expect(screen.getByTestId('settings-cue-dir-early')).toBeVisible()
  })

  // Folded away, Originals still has to say it exists and what it is doing, so the line
  // in view names the level in force.
  it('names the originals level in force outside the fold', () => {
    renderTab({ backupPolicy: 'audioChanges' })
    expect(screen.getByTestId('settings-backup-summary')).toHaveTextContent(
      i18n.t('settings.originalBackupPolicies.audioChanges'),
    )
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
})
