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

  // The offset only means anything once cues are being written into a collection. Shown
  // without one it is an unexplained millisecond box on a feature the user hasn't turned
  // on, which is exactly the invitation to type a number into it that we don't want.
  // Hiding it until a collection is set made the setting impossible to find: the user
  // opens this tab, sees no such field, and has no way to tell whether it exists. Shown
  // but disabled says both things at once — this exists, and it does nothing until you
  // point Surco at a collection — and refuses a number that would sit there inert.
  it('shows the cue offset disabled while no collection is configured', () => {
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
      />,
    )
    expect(screen.getByTestId('settings-traktor-cue-offset')).toBeDisabled()
    expect(screen.getByText(i18n.t('settings.traktorCueOffsetIdle'))).toBeInTheDocument()
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
      />,
    )
    expect(screen.getByTestId('settings-traktor-cue-offset')).toBeEnabled()
    expect(screen.queryByText(i18n.t('settings.traktorCueOffsetIdle'))).not.toBeInTheDocument()
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

  // The number alone tells the user nothing, and this one adjusts something Surco
  // already gets right on its own — so the field has to carry the explanation with it,
  // or it reads as a knob worth turning.
  // Asking for milliseconds asked for a unit no DJ can estimate; the symptom they do
  // perceive is "my cues come in early". The question carries that symptom, and the
  // answer sets the sign and a starting value — the number stays editable underneath.
  it('sets a negative offset when the cues come in early', () => {
    const patch = vi.fn<PatchSynced>()
    renderWithCollection(patch)

    fireEvent.click(screen.getByTestId('settings-cue-drift-early'))

    expect(patch).toHaveBeenCalledWith('traktorCueOffsetMs', '-51')
  })

  it('sets a positive offset when the cues come in late', () => {
    const patch = vi.fn<PatchSynced>()
    renderWithCollection(patch)

    fireEvent.click(screen.getByTestId('settings-cue-drift-late'))

    expect(patch).toHaveBeenCalledWith('traktorCueOffsetMs', '51')
  })

  // The default answer, and the one that has to stay reachable: a DJ who tried an
  // adjustment and found it wrong needs the way back to "leave them alone".
  it('clears the offset when the cues land where they were left', () => {
    const patch = vi.fn<PatchSynced>()
    renderWithCollection(patch, '-51')

    fireEvent.click(screen.getByTestId('settings-cue-drift-none'))

    expect(patch).toHaveBeenCalledWith('traktorCueOffsetMs', '0')
  })

  // Which answer reads as chosen follows the stored value, so reopening Settings shows
  // the state the conversion will actually use rather than a reset default.
  it('marks the answer that matches the stored offset', () => {
    renderWithCollection(vi.fn<PatchSynced>(), '-51')

    expect(screen.getByTestId('settings-cue-drift-early')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('settings-cue-drift-none')).toHaveAttribute('aria-pressed', 'false')
  })

  // The exact figure stays the user's: the reporter arrived at his own after hours of
  // trial and error, and the question only offers a starting point.
  it('keeps the millisecond value editable under the question', () => {
    const patch = vi.fn<PatchSynced>()
    renderWithCollection(patch, '-51')

    const input = screen.getByTestId('settings-traktor-cue-offset')
    expect(input).toHaveValue(-51)
    fireEvent.change(input, { target: { value: '-30' } })
    expect(patch).toHaveBeenCalledWith('traktorCueOffsetMs', '-30')
  })

  // Once the box is editable by hand, the sign is the thing the user cannot guess: the
  // question only covers the two presets, and typing a figure means choosing a direction.
  // The hint has to name both, say how to converge on a value (convert, listen, correct —
  // nobody knows whether to try 20 or 80 the first time), and say what the adjustment
  // does NOT touch: a DJ whose loops changed length would never trust it again.
  it('explains both directions and how to converge on a value', () => {
    renderWithCollection(vi.fn<PatchSynced>(), '-51')

    const hint = screen.getByText(i18n.t('settings.traktorCueOffsetHint'))
    expect(hint.textContent).toMatch(/lower|negative/i)
    expect(hint.textContent).toMatch(/raise|positive/i)
    // The loop the user has to run: convert something, hear it in Traktor, adjust again.
    expect(hint.textContent).toMatch(/convert/i)
    expect(hint.textContent).toMatch(/listen|hear/i)
    expect(hint.textContent).toMatch(/loops/i)
  })

  // The sign alone makes the user translate between milliseconds and what they hear.
  // The readout does that translation for them, and follows the value as it is typed —
  // so a figure entered by hand is confirmed in the same words the answers above use.
  it('says in plain words what the typed value does', () => {
    renderWithCollection(vi.fn<PatchSynced>(), '-51')

    expect(screen.getByTestId('settings-cue-offset-effect')).toHaveTextContent(
      i18n.t('settings.traktorCueOffsetLater', { ms: 51 }),
    )
  })

  it('flips the readout for a positive value', () => {
    renderWithCollection(vi.fn<PatchSynced>(), '30')

    expect(screen.getByTestId('settings-cue-offset-effect')).toHaveTextContent(
      i18n.t('settings.traktorCueOffsetEarlier', { ms: 30 }),
    )
  })

  // At zero there is no effect to describe, and inventing one ("moves them 0 ms") would
  // read as though the setting were doing something.
  it('says the cues are untouched at zero', () => {
    renderWithCollection(vi.fn<PatchSynced>(), '0')

    expect(screen.getByTestId('settings-cue-offset-effect')).toHaveTextContent(
      i18n.t('settings.traktorCueOffsetNone'),
    )
  })

  // Milliseconds mean nothing until you see them against a beat: at 128 BPM a beat runs
  // 469 ms, so 51 ms is 11% of one. The drawing puts the cue on the grid and marks where
  // it used to sit, which shows the size and the direction of the change at a glance.
  it('draws the cue displaced from the beat it was on', () => {
    renderWithCollection(vi.fn<PatchSynced>(), '-51')

    const moved = screen.getByTestId('cue-grid-cue')
    const origin = screen.getByTestId('cue-grid-origin')
    // A negative offset delays the cue, and later means further right on a timeline.
    expect(Number(moved.getAttribute('x1'))).toBeGreaterThan(Number(origin.getAttribute('x1')))
  })

  it('draws the cue ahead of the beat for a positive offset', () => {
    renderWithCollection(vi.fn<PatchSynced>(), '51')

    const moved = screen.getByTestId('cue-grid-cue')
    const origin = screen.getByTestId('cue-grid-origin')
    expect(Number(moved.getAttribute('x1'))).toBeLessThan(Number(origin.getAttribute('x1')))
  })

  // Nothing has moved, so the cue sits exactly on its beat and there is no displacement
  // to draw — a visible gap at zero would contradict the reading right next to it.
  it('draws the cue on the beat when there is no adjustment', () => {
    renderWithCollection(vi.fn<PatchSynced>(), '0')

    const moved = screen.getByTestId('cue-grid-cue')
    const origin = screen.getByTestId('cue-grid-origin')
    expect(moved.getAttribute('x1')).toBe(origin.getAttribute('x1'))
  })

  // The drawing only ever claims what Surco actually knows — the beat grid and where the
  // cue sits on it. It must not draw a waveform: Surco cannot know where the transient
  // of this DJ's track falls, and a drawn hit would suggest the cue is being aligned to
  // real audio rather than to the grid.
  it('draws no waveform it cannot know', () => {
    renderWithCollection(vi.fn<PatchSynced>(), '-51')

    expect(screen.queryByTestId('cue-grid-waveform')).not.toBeInTheDocument()
  })

  // Caught in the real app: the first geometry drew six beat lines of which only two
  // landed inside the frame, so there was effectively no grid to read the cue against.
  // The point of the drawing is the comparison, so several lines have to be visible.
  it('keeps enough of the grid inside the frame to read the cue against', () => {
    renderWithCollection(vi.fn<PatchSynced>(), '-51')

    const svg = screen.getByRole('img')
    const width = Number(svg.getAttribute('viewBox')?.split(' ')[2])
    // Only the grid lines: counting every line would also count the cue, its dotted
    // origin and the displacement bar, all of which sit inside the frame by construction
    // — which is how the first version of this test passed against the broken geometry.
    const gridInside = [...svg.querySelectorAll('line')].filter((line) => {
      if (line.getAttribute('stroke') !== 'var(--color-line-strong)') return false
      const x = Number(line.getAttribute('x1'))
      return x >= 0 && x <= width
    })

    expect(gridInside.length).toBeGreaterThanOrEqual(4)
  })
})
