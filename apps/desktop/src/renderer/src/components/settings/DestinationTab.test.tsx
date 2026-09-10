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
      onClearTraktorNmlPath={vi.fn()}
      detectedNmlPath={null}
      onAcceptDetectedNmlPath={vi.fn()}
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
      onClearTraktorNmlPath={vi.fn()}
      detectedNmlPath={null}
      onAcceptDetectedNmlPath={vi.fn()}
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
    expect(screen.getByTestId('settings-traktor-nml')).toHaveTextContent('')
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
        onClearTraktorNmlPath={vi.fn()}
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
        onClearTraktorNmlPath={vi.fn()}
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
        onClearTraktorNmlPath={vi.fn()}
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
        onClearTraktorNmlPath={vi.fn()}
        detectedNmlPath="/Users/dj/Documents/Native Instruments/Traktor 4.5.0/collection.nml"
        onAcceptDetectedNmlPath={onAcceptDetectedNmlPath}
      />,
    )
    fireEvent.click(screen.getByTestId('settings-traktor-nml-use-detected'))
    expect(onAcceptDetectedNmlPath).toHaveBeenCalled()
  })

  // Reported 09/09/2026: "look into being able to turn off loading the nml, because
  // there's no way to leave it empty — I have to point it at another path to test".
  // The hint says "leave it empty to turn this off" and the tab offered only Change,
  // which opens a file picker: the one promise the UI could not keep, and the only way
  // to stop Surco touching a collection while something is being debugged.
  it('clears the collection path so the sync can be turned off', () => {
    const onClearTraktorNmlPath = vi.fn()
    render(
      <DestinationTab
        synced={synced}
        local={{ ...local, traktorNmlPath: '/dj/collection.nml' }}
        patch={vi.fn()}
        onOutputDirChange={vi.fn()}
        onChangeEngineDir={vi.fn()}
        onChangeTraktorNmlPath={vi.fn()}
        onClearTraktorNmlPath={onClearTraktorNmlPath}
        detectedNmlPath={null}
        onAcceptDetectedNmlPath={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByTestId('settings-traktor-nml-clear'))
    expect(onClearTraktorNmlPath).toHaveBeenCalled()
  })

  // Nothing configured means nothing to clear, and a live button that does nothing reads
  // as broken.
  it('offers nothing to clear while no collection is set', () => {
    render(
      <DestinationTab
        synced={synced}
        local={local}
        patch={vi.fn()}
        onOutputDirChange={vi.fn()}
        onChangeEngineDir={vi.fn()}
        onChangeTraktorNmlPath={vi.fn()}
        onClearTraktorNmlPath={vi.fn()}
        detectedNmlPath={null}
        onAcceptDetectedNmlPath={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('settings-traktor-nml-clear')).not.toBeInTheDocument()
  })

  // Reported 10/09/2026: "if I don't set the nml I can't leave that set", and "the nml
  // isn't needed for converting". He is right, and the premise this was built on was
  // wrong: the offset moves the cues written INTO THE CONVERTED FILE, which happens on
  // every conversion whether or not Traktor's collection is involved. Measured with the
  // collection unset — flac to mp3 at +51 moves a cue from 10000 to 10051 — so disabling
  // the control was the UI refusing an adjustment the conversion was ready to apply.
  // The collection path only decides whether the tracks ALREADY in Traktor get updated.
  it('keeps the cue offset usable with no collection configured', () => {
    render(
      <DestinationTab
        synced={synced}
        local={local}
        patch={vi.fn()}
        onOutputDirChange={vi.fn()}
        onChangeEngineDir={vi.fn()}
        onChangeTraktorNmlPath={vi.fn()}
        onClearTraktorNmlPath={vi.fn()}
        detectedNmlPath={null}
        onAcceptDetectedNmlPath={vi.fn()}
      />,
    )
    expect(screen.getByTestId('settings-cue-preset--25')).toBeEnabled()
    cleanup()
    render(
      <DestinationTab
        synced={synced}
        local={{ ...local, traktorNmlPath: '/dj/collection.nml' }}
        patch={vi.fn()}
        onOutputDirChange={vi.fn()}
        onChangeEngineDir={vi.fn()}
        onChangeTraktorNmlPath={vi.fn()}
        onClearTraktorNmlPath={vi.fn()}
        detectedNmlPath={null}
        onAcceptDetectedNmlPath={vi.fn()}
      />,
    )
    expect(screen.getByTestId('settings-cue-preset--25')).toBeEnabled()
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
        onClearTraktorNmlPath={vi.fn()}
        detectedNmlPath={null}
        onAcceptDetectedNmlPath={vi.fn()}
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

  // One signed row instead of a question plus an unsigned row of sizes. Splitting the
  // sign from the size needed a question to carry the direction, a second control to
  // carry the magnitude, and a sentence to translate the result back into words — four
  // controls for one number. A button that already says "-25 ms" is the whole decision.
  it('sets the offset the chosen preset names', () => {
    const patch = vi.fn<PatchSynced>()
    renderWithCollection(patch)

    fireEvent.click(screen.getByTestId('settings-cue-preset--25'))

    expect(patch).toHaveBeenCalledWith('traktorCueOffsetMs', '-25')
  })

  it('sets a positive offset from the positive preset', () => {
    const patch = vi.fn<PatchSynced>()
    renderWithCollection(patch)

    fireEvent.click(screen.getByTestId('settings-cue-preset-25'))

    expect(patch).toHaveBeenCalledWith('traktorCueOffsetMs', '25')
  })

  // The way back to "leave them alone" is a preset like any other, not a separate answer:
  // a DJ who tried an adjustment and found it wrong needs it in the same row they used.
  it('clears the offset from the middle preset', () => {
    const patch = vi.fn<PatchSynced>()
    renderWithCollection(patch, '-51')

    fireEvent.click(screen.getByTestId('settings-cue-preset-0'))

    expect(patch).toHaveBeenCalledWith('traktorCueOffsetMs', '0')
  })

  // Which preset reads as chosen follows the stored value, so reopening Settings shows the
  // state the conversion will actually use rather than a reset default.
  it('marks the preset that matches the stored offset', () => {
    renderWithCollection(vi.fn<PatchSynced>(), '-25')

    expect(screen.getByTestId('settings-cue-preset--25')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('settings-cue-preset-0')).toHaveAttribute('aria-pressed', 'false')
  })

  // A hand-tuned figure between presets must not light one up: 51 is not 50, and marking
  // the nearest would tell the user their value had been rounded.
  it('marks no preset for a value between them', () => {
    renderWithCollection(vi.fn<PatchSynced>(), '-51')

    expect(screen.getByTestId('settings-cue-preset--50')).toHaveAttribute('aria-pressed', 'false')
  })

  // The presets are shortcuts, not the range. The reporter arrived at 51 ms by ear over a
  // long session and no row of round numbers contains it, so the slider is what keeps
  // every value reachable — signed like the presets, so it needs no direction of its own.
  it('tunes to a value no preset offers', () => {
    const patch = vi.fn<PatchSynced>()
    renderWithCollection(patch, '-51')

    const slider = screen.getByTestId('settings-cue-fine')
    expect(slider).toHaveValue('-51')
    fireEvent.change(slider, { target: { value: '-38' } })

    expect(patch).toHaveBeenCalledWith('traktorCueOffsetMs', '-38')
  })

  // The collection path gates what Traktor is told about tracks it ALREADY holds — their
  // cues and their metadata. It does not gate the cues written into the converted file,
  // which is what this offset moves, so the controls stay usable without one.
  it('keeps the presets usable while no collection is configured', () => {
    render(
      <DestinationTab
        synced={synced}
        local={local}
        patch={vi.fn()}
        onOutputDirChange={vi.fn()}
        onChangeEngineDir={vi.fn()}
        onChangeTraktorNmlPath={vi.fn()}
        onClearTraktorNmlPath={vi.fn()}
        detectedNmlPath={null}
        onAcceptDetectedNmlPath={vi.fn()}
      />,
    )

    expect(screen.getByTestId('settings-cue-preset--25')).toBeEnabled()
    expect(screen.getByTestId('settings-cue-fine')).toBeEnabled()
  })

  // The other half of the same correction: not merely enabled to look at, but actually
  // staging the value. The reporter's whole complaint was that he could not leave his
  // +51 set without pointing Surco at a collection he did not need for converting.
  it('stages a preset picked with no collection set', () => {
    const patch = vi.fn<PatchSynced>()
    render(
      <DestinationTab
        synced={synced}
        local={local}
        patch={patch}
        onOutputDirChange={vi.fn()}
        onChangeEngineDir={vi.fn()}
        onChangeTraktorNmlPath={vi.fn()}
        onClearTraktorNmlPath={vi.fn()}
        detectedNmlPath={null}
        onAcceptDetectedNmlPath={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByTestId('settings-cue-preset--25'))

    expect(patch).toHaveBeenCalledWith('traktorCueOffsetMs', '-25')
  })

  // The hint is the only prose left, so it carries what the controls cannot: that the
  // normal state is no adjustment (this corrects something Surco already gets right), the
  // loop nobody can shortcut, and what the adjustment does NOT touch — a DJ whose loops
  // changed length would never trust it again.
  it('says the normal case is no adjustment and what it leaves alone', () => {
    renderWithCollection(vi.fn<PatchSynced>(), '-51')

    const hint = screen.getByText(i18n.t('settings.traktorCueOffsetHint'))
    expect(hint.textContent).toMatch(/already corrects|no adjustment/i)
    expect(hint.textContent).toMatch(/listen|hear/i)
    expect(hint.textContent).toMatch(/loops/i)
  })

  // Reported 09/09/2026 by the DJ this setting exists for: "I had to apply mine at 51 —
  // you put it the other way round". The controls show a signed number and nothing says
  // which way each sign moves the cue, so the only way to find out is to convert, listen,
  // and guess again. Naming both directions is what turns that into one reading.
  it('says which way each sign moves the cue', () => {
    renderWithCollection(vi.fn<PatchSynced>(), '-51')

    const hint = screen.getByText(i18n.t('settings.traktorCueOffsetHint'))
    expect(hint.textContent).toMatch(/negative/i)
    expect(hint.textContent).toMatch(/positive/i)
  })

  // The sign in the box is arithmetic; this restates it as the thing the DJ will hear,
  // and follows the value as it is typed. It went missing when the row of presets
  // replaced the earlier question, which is how the direction stopped being stated
  // anywhere at all.
  // The direction comes from a measurement, not from reading the formula: a real
  // conversion takes a cue stored at 10000 ms to 9949 under -51, which is nearer the
  // start of the track and therefore EARLIER. Asserting it the other way round is how
  // this got shipped stating the opposite.
  it('restates the chosen value in plain words', () => {
    renderWithCollection(vi.fn<PatchSynced>(), '-51')

    expect(screen.getByTestId('settings-cue-offset-effect')).toHaveTextContent(
      i18n.t('settings.traktorCueOffsetEarlier', { ms: 51 }),
    )
  })

  it('flips that reading for a positive value', () => {
    renderWithCollection(vi.fn<PatchSynced>(), '25')

    expect(screen.getByTestId('settings-cue-offset-effect')).toHaveTextContent(
      i18n.t('settings.traktorCueOffsetLater', { ms: 25 }),
    )
  })

  it('says nothing moves at zero', () => {
    renderWithCollection(vi.fn<PatchSynced>(), '0')

    expect(screen.getByTestId('settings-cue-offset-effect')).toHaveTextContent(
      i18n.t('settings.traktorCueOffsetNone'),
    )
  })
})
