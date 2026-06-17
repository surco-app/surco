// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { createRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  KeyNotation,
  LoudnessResult,
  NormalizeConfig,
  OutputFormat,
  TrackMetadata,
  TrackProperties,
} from '../../../shared/types'
import { resetEditorSections } from '../hooks/useEditorSections'
import i18n from '../i18n'
import type { TrackItem } from '../types'
import { Editor } from './Editor'

afterEach(cleanup)

// The Editor's read-only data (currently Properties) is fetched through React Query,
// so every mount needs a client in context. A fresh client per render keeps tests
// isolated; retry:false lets a rejected probe settle into isError within waitFor.
function renderWithQuery(ui: React.ReactElement): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

// Editor mounts effects that touch window.api; a non-darwin platform skips the
// Apple Music lookup and showSpectrum={false} skips the spectrogram analysis, so
// the bridge only needs `platform` and the handful of methods used on click.
beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    platform: 'win32',
    reveal: vi.fn(),
    // The Properties effect probes once per single track on mount; resolve to null
    // so tests that don't care about it don't hit an undefined bridge method.
    properties: vi.fn().mockResolvedValue(null),
    // The Quality panel analyses the spectrum whenever showSpectrum is on (the
    // multi-select editor does); resolve to null so that fetch never hits an
    // undefined bridge method.
    spectrogram: vi.fn().mockResolvedValue(null),
    // The cover well checks the clipboard on mount (and on window focus) to decide
    // whether to show its paste button; default to empty and a no-op unsubscribe.
    hasClipboardImage: vi.fn().mockResolvedValue(false),
    onWindowFocus: vi.fn(() => () => {}),
  }
  // Section fold state persists in a module store across editor remounts; reset it so a
  // section a previous test toggled doesn't start the next one in the opposite state.
  resetEditorSections()
})

function item(
  over: Partial<Omit<TrackItem, 'meta'>> & { id: string; meta?: Partial<TrackMetadata> },
): TrackItem {
  return {
    inputPath: `/music/${over.id}.wav`,
    fileName: `${over.id}.wav`,
    listLabel: over.meta?.title || `${over.id}.wav`,
    query: '',
    status: 'idle',
    ...over,
    meta: {
      title: '',
      artist: '',
      album: '',
      albumArtist: '',
      year: '',
      genre: '',
      grouping: '',
      comment: '',
      trackNumber: '',
      discNumber: '',
      bpm: '',
      key: '',
      publisher: '',
      catalogNumber: '',
      remixArtist: '',
      ...over.meta,
    },
  }
}

function renderEditor(
  over: Partial<Omit<TrackItem, 'meta'>> & { id: string; meta?: Partial<TrackMetadata> },
  outputFormat: OutputFormat = 'wav',
  props: {
    requiredFields?: string[]
    visibleFields?: string[]
    genrePresets?: string[]
    showLoudness?: boolean
    normalize?: NormalizeConfig
    overwriteOriginal?: boolean
    keyNotation?: KeyNotation
    discogsFormats?: string[]
  } = {},
): {
  onProcess: ReturnType<typeof vi.fn>
  onChange: ReturnType<typeof vi.fn>
  onDeriveTags: ReturnType<typeof vi.fn>
  onFormatChange: ReturnType<typeof vi.fn>
  onTrashOriginal: ReturnType<typeof vi.fn>
  onOpenSettings: ReturnType<typeof vi.fn>
  onShowLoudnessHelp: ReturnType<typeof vi.fn>
  onOpenRename: ReturnType<typeof vi.fn>
  onRegenerateName: ReturnType<typeof vi.fn>
  onCopyFilename: ReturnType<typeof vi.fn>
} {
  const onProcess = vi.fn()
  const onChange = vi.fn()
  const onDeriveTags = vi.fn()
  const onFormatChange = vi.fn()
  const onTrashOriginal = vi.fn()
  const onOpenSettings = vi.fn()
  const onShowLoudnessHelp = vi.fn()
  const onOpenRename = vi.fn()
  const onRegenerateName = vi.fn()
  const onCopyFilename = vi.fn()
  renderWithQuery(
    <Editor
      item={item(over)}
      hasToken
      outputFormat={outputFormat}
      addToAppleMusic={false}
      overwriteOriginal={props.overwriteOriginal ?? false}
      groupingPresets={[]}
      genrePresets={props.genrePresets ?? []}
      visibleFields={props.visibleFields ?? []}
      requiredFields={props.requiredFields ?? []}
      discogsFormats={props.discogsFormats ?? []}
      showSpectrum={false}
      showLoudness={props.showLoudness ?? false}
      keyNotation={props.keyNotation ?? 'camelot'}
      normalize={props.normalize ?? { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 }}
      searchInputRef={createRef<HTMLInputElement>()}
      onChange={onChange}
      onProcess={onProcess}
      onFormatChange={onFormatChange}
      onDeriveTags={onDeriveTags}
      onAddToAppleMusic={vi.fn()}
      onTrashOriginal={onTrashOriginal}
      onOpenSettings={onOpenSettings}
      onShowLoudnessHelp={onShowLoudnessHelp}
      onOpenRename={onOpenRename}
      onRegenerateName={onRegenerateName}
      onCopyFilename={onCopyFilename}
    />,
  )
  return {
    onProcess,
    onChange,
    onDeriveTags,
    onFormatChange,
    onTrashOriginal,
    onOpenSettings,
    onShowLoudnessHelp,
    onOpenRename,
    onRegenerateName,
    onCopyFilename,
  }
}

describe('Editor cover picker', () => {
  afterEach(() => vi.unstubAllGlobals())

  // Artwork must be reachable by clicking to browse the filesystem, not only by drag —
  // many users never think to drag an image onto the empty cover well.
  it('applies an image chosen through the file input', () => {
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:cover' })
    ;(window as unknown as { api: Record<string, unknown> }).api.getPathForFile = () => '/img/c.png'
    const { onChange } = renderEditor({ id: 'a' })
    const file = new File(['x'], 'c.png', { type: 'image/png' })
    fireEvent.change(screen.getByTestId('cover-input'), { target: { files: [file] } })
    expect(onChange).toHaveBeenCalledWith({
      coverUrl: 'blob:cover',
      coverPath: '/img/c.png',
      coverRemoved: false,
    })
  })

  // Clearing the artwork must signal a real removal (coverRemoved), not just drop
  // the URL — otherwise the conversion's in-place path would keep the embedded art.
  it('clears the cover and flags removal when the remove button is clicked', () => {
    ;(window as unknown as { api: Record<string, unknown> }).api.prepareCoverDrag = () =>
      Promise.resolve('/tmp/c.jpg')
    const { onChange } = renderEditor({ id: 'a', coverUrl: 'data:image/png;base64,xxx' })
    fireEvent.click(screen.getByTestId('cover-remove'))
    expect(onChange).toHaveBeenCalledWith({
      coverUrl: undefined,
      coverPath: undefined,
      coverRemoved: true,
    })
  })

  // Showing the pixel size lets the user judge whether the Discogs cover is sharp
  // enough; a small one (e.g. 255px) is flagged by the dot turning amber so they
  // know to find a better one — the colour carries it, no extra "low resolution" text.
  it('shows the artwork resolution and flags a low-res cover', () => {
    ;(window as unknown as { api: Record<string, unknown> }).api.prepareCoverDrag = () =>
      Promise.resolve(null)
    renderEditor({ id: 'a', coverUrl: 'blob:cover' })
    const img = screen.getByTestId('cover-preview')
    Object.defineProperty(img, 'naturalWidth', { value: 255, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: 255, configurable: true })
    fireEvent.load(img)
    expect(screen.getByTestId('cover-resolution')).toHaveTextContent('255 × 255 px')
    expect(screen.getByTestId('cover-quality-dot')).toHaveAttribute('data-lowres', 'true')
  })

  it('does not flag a high-res cover', () => {
    ;(window as unknown as { api: Record<string, unknown> }).api.prepareCoverDrag = () =>
      Promise.resolve(null)
    renderEditor({ id: 'a', coverUrl: 'blob:cover' })
    const img = screen.getByTestId('cover-preview')
    Object.defineProperty(img, 'naturalWidth', { value: 600, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true })
    fireEvent.load(img)
    expect(screen.getByTestId('cover-resolution')).toHaveTextContent('600 × 600 px')
    expect(screen.getByTestId('cover-quality-dot')).toHaveAttribute('data-lowres', 'false')
  })

  // The 160px well can't show whether art is actually sharp or what it depicts;
  // clicking it opens the artwork big, and the backdrop click puts it away.
  it('opens the cover large when the thumbnail is clicked and closes it from the backdrop', () => {
    ;(window as unknown as { api: Record<string, unknown> }).api.prepareCoverDrag = () =>
      Promise.resolve(null)
    renderEditor({ id: 'a', coverUrl: 'blob:cover' })
    fireEvent.click(screen.getByTestId('cover-zoom'))
    expect(screen.getByTestId('cover-lightbox-img')).toHaveAttribute('src', 'blob:cover')
    fireEvent.click(screen.getByTestId('cover-lightbox-backdrop'))
    expect(screen.queryByTestId('cover-lightbox-img')).not.toBeInTheDocument()
  })

  // App's global Escape only closes App-owned modals; the lightbox is editor-local,
  // so it must dismiss itself or Escape would dead-end while it covers the screen.
  it('closes the lightbox with Escape', () => {
    ;(window as unknown as { api: Record<string, unknown> }).api.prepareCoverDrag = () =>
      Promise.resolve(null)
    renderEditor({ id: 'a', coverUrl: 'blob:cover' })
    fireEvent.click(screen.getByTestId('cover-zoom'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('cover-lightbox-img')).not.toBeInTheDocument()
  })

  // The renderer's session-long copy of embedded art is a 512px thumbnail; viewing
  // it large must pull the original from the audio file, or the lightbox would just
  // scale up the thumbnail and lie about the artwork's real quality.
  it('upgrades an embedded cover to the full-resolution original in the lightbox', async () => {
    const api = (window as unknown as { api: Record<string, unknown> }).api
    api.prepareCoverDrag = () => Promise.resolve(null)
    const readCoverFull = vi.fn().mockResolvedValue('data:image/jpeg;base64,FULL')
    api.readCoverFull = readCoverFull
    renderEditor({
      id: 'a',
      inputPath: '/m/a.wav',
      coverUrl: 'data:image/jpeg;base64,thumb',
      embeddedCover: 'data:image/jpeg;base64,thumb',
    })
    fireEvent.click(screen.getByTestId('cover-zoom'))
    await waitFor(() =>
      expect(screen.getByTestId('cover-lightbox-img')).toHaveAttribute(
        'src',
        'data:image/jpeg;base64,FULL',
      ),
    )
    expect(readCoverFull).toHaveBeenCalledWith('/m/a.wav')
  })

  // A Discogs or user-picked cover is already the full image — asking main to
  // extract anything from the audio file would be wasted work (and wrong art).
  it('does not extract from the file when the shown cover is not the embedded one', () => {
    const api = (window as unknown as { api: Record<string, unknown> }).api
    api.prepareCoverDrag = () => Promise.resolve(null)
    const readCoverFull = vi.fn()
    api.readCoverFull = readCoverFull
    renderEditor({ id: 'a', inputPath: '/m/a.wav', coverUrl: 'https://discogs/full.jpg' })
    fireEvent.click(screen.getByTestId('cover-zoom'))
    expect(screen.getByTestId('cover-lightbox-img')).toHaveAttribute(
      'src',
      'https://discogs/full.jpg',
    )
    expect(readCoverFull).not.toHaveBeenCalled()
  })
})

describe('Editor derive from filename', () => {
  // The control fills tags from the file name (filename → tags), the inverse of File Name's
  // Regenerate (tags → filename); it lives in the metadata header so the two never look alike.
  it('fills the track tags from its file name in one click', () => {
    const { onDeriveTags } = renderEditor({ id: 'a', fileName: '104. kumara - snap.flac' })
    fireEvent.click(screen.getByTestId('derive-btn'))
    expect(onDeriveTags).toHaveBeenCalledWith([
      { id: 'a', meta: { trackNumber: '104', artist: 'kumara', title: 'snap' } },
    ])
  })
})

describe('Editor copy filename', () => {
  // A read-only companion to Regenerate: instead of writing the naming pattern into the
  // output name, it hands the name to the clipboard so the user can paste the track into
  // Google or Soulseek to hunt for a better rip. App owns the pattern and clipboard, so the
  // button just signals intent.
  it('copies the file name in one click', () => {
    const { onCopyFilename } = renderEditor({ id: 'a' })
    fireEvent.click(screen.getByTestId('copy-filename-btn'))
    expect(onCopyFilename).toHaveBeenCalledTimes(1)
  })
})

describe('Editor clear metadata', () => {
  // The inverse of the fill controls (filename / Discogs): one click empties every
  // field so the user can retag a badly-labelled file from scratch instead of
  // deleting fifteen values by hand. Artwork is untouched — the cover picker owns it.
  it('empties every metadata field of the track in one click', () => {
    const { onChange } = renderEditor({
      id: 'a',
      meta: { title: 'Runaway', artist: 'Alex K', genre: 'Electronic', rating: '4' },
    })
    fireEvent.click(screen.getByTestId('clear-meta-btn'))
    expect(onChange).toHaveBeenCalledWith({
      meta: {
        title: '',
        artist: '',
        album: '',
        albumArtist: '',
        year: '',
        genre: '',
        grouping: '',
        comment: '',
        trackNumber: '',
        discNumber: '',
        bpm: '',
        key: '',
        publisher: '',
        catalogNumber: '',
        remixArtist: '',
        discogsReleaseId: '',
        rating: '',
        composer: '',
        isrc: '',
        mixName: '',
        originalYear: '',
        compilation: '',
      },
    })
  })
})

describe('Editor compilation field', () => {
  // A compilation is a yes/no fact, not free text: a checkbox writes the exact
  // '1' the TCMP/COMPILATION tag needs, where a text field would invite junk.
  it('renders a checkbox that writes 1 when ticked', () => {
    const { onChange } = renderEditor({ id: 'a' }, 'wav', { visibleFields: ['compilation'] })
    const box = screen.getByTestId('field-compilation')
    expect(box).toHaveProperty('checked', false)
    fireEvent.click(box)
    expect(onChange).toHaveBeenCalledWith({ meta: expect.objectContaining({ compilation: '1' }) })
  })

  it('unticks back to an empty value, clearing the tag on the next write', () => {
    const { onChange } = renderEditor({ id: 'a', meta: { compilation: '1' } }, 'wav', {
      visibleFields: ['compilation'],
    })
    const box = screen.getByTestId('field-compilation')
    expect(box).toHaveProperty('checked', true)
    fireEvent.click(box)
    expect(onChange).toHaveBeenCalledWith({ meta: expect.objectContaining({ compilation: '' }) })
  })
})

describe('Editor convert button normalization note', () => {
  // Normalization must be visible at the moment of converting, not just buried in a
  // folded section — otherwise the user can't tell the export will alter loudness.
  it('flags the active normalization above the convert button', () => {
    renderEditor({ id: 'a' }, 'wav', {
      normalize: { mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
    })
    const note = screen.getByTestId('convert-normalize-note')
    expect(note).toHaveTextContent('-14')
  })

  it('shows no note when normalization is off', () => {
    renderEditor({ id: 'a' }, 'wav')
    expect(screen.queryByTestId('convert-normalize-note')).toBeNull()
  })
})

describe('Editor loudness pills', () => {
  const healthy: LoudnessResult = {
    integratedLufs: -12,
    truePeakDb: -1.5,
    lra: 8,
    channelBalanceDb: 0.5,
    dcOffset: 0.0001,
    crestDb: 16,
    noiseFloorDb: -55,
  }

  // Like the tempo probe, the ffmpeg loudness pass waits for the selection to rest
  // instead of measuring every row a j/k sweep passes through.
  it('does not measure loudness until the selection rests on the track', async () => {
    const loudness = vi.fn().mockResolvedValue(healthy)
    ;(window as unknown as { api: { loudness: unknown } }).api.loudness = loudness
    renderEditor({ id: 'a' }, 'wav', { showLoudness: true })
    await new Promise((r) => setTimeout(r, 0))
    expect(loudness).not.toHaveBeenCalled()
    await screen.findByTestId('loudness-pill-lufs')
    expect(loudness).toHaveBeenCalledTimes(1)
  })

  // The figures come from the main-process measure (window.api.loudness) the readout
  // runs on mount, so each test seeds what that measure returns for this file.
  function seedLoudness(value: LoudnessResult): void {
    ;(window as unknown as { api: { loudness: unknown } }).api.loudness = vi
      .fn()
      .mockResolvedValue(value)
  }

  // The whole point of the colour is that a non-technical user reads the verdict
  // without understanding LUFS/dBTP/LU: a near-silent, clipping, flat track is
  // wrong on all three counts and must read red across the board.
  it('grades a near-silent, clipping, flat track as bad on every pill', async () => {
    seedLoudness({
      integratedLufs: -70,
      truePeakDb: 2.5,
      lra: 0,
      channelBalanceDb: 6,
      dcOffset: 0.03,
      crestDb: 5,
      noiseFloorDb: -20,
    })
    renderEditor({ id: 'a' }, 'wav', { showLoudness: true })
    expect(await screen.findByTestId('loudness-pill-lufs')).toHaveAttribute('data-grade', 'bad')
    expect(screen.getByTestId('loudness-pill-peak')).toHaveAttribute('data-grade', 'bad')
    expect(screen.getByTestId('loudness-pill-range')).toHaveAttribute('data-grade', 'bad')
    expect(screen.getByTestId('loudness-pill-crest')).toHaveAttribute('data-grade', 'bad')
    expect(screen.getByTestId('loudness-pill-balance')).toHaveAttribute('data-grade', 'bad')
    expect(screen.getByTestId('loudness-pill-dc')).toHaveAttribute('data-grade', 'bad')
    expect(screen.getByTestId('loudness-pill-noise')).toHaveAttribute('data-grade', 'bad')
  })

  it('grades a healthy track green on every pill', async () => {
    seedLoudness(healthy)
    renderEditor({ id: 'a' }, 'wav', { showLoudness: true })
    expect(await screen.findByTestId('loudness-pill-lufs')).toHaveAttribute('data-grade', 'good')
    expect(screen.getByTestId('loudness-pill-peak')).toHaveAttribute('data-grade', 'good')
    expect(screen.getByTestId('loudness-pill-range')).toHaveAttribute('data-grade', 'good')
    expect(screen.getByTestId('loudness-pill-crest')).toHaveAttribute('data-grade', 'good')
    expect(screen.getByTestId('loudness-pill-balance')).toHaveAttribute('data-grade', 'good')
    expect(screen.getByTestId('loudness-pill-dc')).toHaveAttribute('data-grade', 'good')
    expect(screen.getByTestId('loudness-pill-noise')).toHaveAttribute('data-grade', 'good')
  })

  it('drops the balance pill for a mono rip, where there is no left/right to compare', async () => {
    seedLoudness({ ...healthy, channelBalanceDb: null })
    renderEditor({ id: 'a' }, 'wav', { showLoudness: true })
    await screen.findByTestId('loudness-pill-lufs')
    expect(screen.queryByTestId('loudness-pill-balance')).toBeNull()
    expect(screen.getByTestId('loudness-pill-dc')).toBeInTheDocument()
  })

  // The explainer modal is owned by App (so it gates the global shortcuts like every
  // other dialog); the editor's ⓘ button only signals the intent upward.
  it('asks App to show the explanation when the help button is pressed', async () => {
    seedLoudness(healthy)
    const { onShowLoudnessHelp } = renderEditor({ id: 'a' }, 'wav', { showLoudness: true })
    fireEvent.click(await screen.findByTestId('loudness-help-toggle'))
    expect(onShowLoudnessHelp).toHaveBeenCalledTimes(1)
  })

  // The toggle is icon-only, so without an accessible name a screen reader just
  // announces "button" with no clue it opens the loudness explanation.
  it('gives the icon-only help toggle an accessible name', async () => {
    seedLoudness(healthy)
    renderEditor({ id: 'a' }, 'wav', { showLoudness: true })
    expect(await screen.findByTestId('loudness-help-toggle')).toHaveAccessibleName()
  })
})

// Mirrors App's real wiring (tracks in state, updateTracksMeta over the selection) so a
// reported bug — editing one shared field, then another, only saving the first — can be
// reproduced or ruled out as a logic problem rather than a focus/UI one.
function MultiHarness() {
  const [tracks, setTracks] = useState<TrackItem[]>([
    item({ id: 'a', meta: { title: 'A', album: 'Shared' } }),
    item({ id: 'b', meta: { title: 'B', album: 'Shared' } }),
  ])
  const ids = ['a', 'b']
  const selectedTracks = tracks.filter((t) => ids.includes(t.id))
  const selected = tracks.find((t) => t.id === 'a') as TrackItem
  const updateAll = (patch: Partial<TrackMetadata>) =>
    setTracks((prev) =>
      prev.map((t) => (ids.includes(t.id) ? { ...t, meta: { ...t.meta, ...patch } } : t)),
    )
  return (
    <>
      <Editor
        key={selected.id}
        item={selected}
        overwriteOriginal={false}
        keyNotation="camelot"
        hasToken
        outputFormat="aiff"
        addToAppleMusic={false}
        groupingPresets={[]}
        genrePresets={[]}
        visibleFields={['title', 'album', 'year', 'genre']}
        requiredFields={[]}
        discogsFormats={[]}
        showSpectrum={false}
        showLoudness={false}
        normalize={{ mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 }}
        searchInputRef={createRef<HTMLInputElement>()}
        selectedTracks={selectedTracks}
        onApplyMatches={vi.fn()}
        onProcessAll={vi.fn()}
        onAddAllToAppleMusic={vi.fn()}
        onChangeAllMeta={updateAll}
        onApplyCoverAll={vi.fn()}
        onDeriveTags={vi.fn()}
        onChange={vi.fn()}
        onProcess={vi.fn()}
        onAddToAppleMusic={vi.fn()}
        onOpenSettings={vi.fn()}
        onShowLoudnessHelp={vi.fn()}
        onOpenRename={vi.fn()}
        onRegenerateName={vi.fn()}
        onCopyFilename={vi.fn()}
      />
      <div data-testid="dump">
        {tracks.map((t) => `${t.id}:${t.meta.year || '-'},${t.meta.genre || '-'}`).join('|')}
      </div>
    </>
  )
}

describe('Editor genre presets', () => {
  // A release that isn't on Discogs leaves the Genre field with no quick buttons,
  // so the user's own default genres must surface as pills on their own and set
  // the field when clicked — the whole point of asking for them in onboarding.
  it('offers the user default genres as pills with no Discogs release', () => {
    const { onChange } = renderEditor({ id: 'a' }, 'wav', {
      visibleFields: ['genre'],
      genrePresets: ['Hard Dance', 'Techno'],
    })
    fireEvent.click(screen.getByTestId('chip-Hard Dance'))
    expect(onChange).toHaveBeenCalledWith({
      meta: expect.objectContaining({ genre: 'Hard Dance' }),
    })
  })
})

describe('Editor Discogs loading skeleton', () => {
  // While the search round-trips, the results column held only the static "choose an
  // album" hint — indistinguishable from "nothing happening". Skeleton rows hold the
  // column's shape so the results don't pop into an area that looked idle.
  it('holds the results column with a skeleton while the search is in flight', async () => {
    let settle: (r: unknown[]) => void = () => {}
    ;(window as unknown as { api: Record<string, unknown> }).api.searchDiscogs = vi.fn(
      () =>
        new Promise((res) => {
          settle = res
        }),
    )
    renderEditor({ id: 'a', query: 'artist song' })

    expect(await screen.findByTestId('discogs-skeleton')).toBeInTheDocument()

    settle([])
    await waitFor(() => expect(screen.queryByTestId('discogs-skeleton')).toBeNull())
  })
})

describe('Editor embedded cover size', () => {
  // The shown embedded cover is a display thumbnail, so the size pill (and the
  // low-res verdict behind it) must read the original dimensions probed at import —
  // measuring the thumbnail would flag every good cover as too small.
  it('shows the original art size for the file’s own cover, not the thumbnail’s', async () => {
    ;(window as unknown as { api: Record<string, unknown> }).api.prepareCoverDrag = () =>
      Promise.resolve(null)
    const thumb = 'data:image/jpeg;base64,thumb'
    renderEditor({
      id: 'a',
      coverUrl: thumb,
      embeddedCover: thumb,
      embeddedCoverDims: { w: 1400, h: 1400 },
    })
    expect(await screen.findByText('1400 × 1400 px')).toBeInTheDocument()
  })
})

describe('Editor bpm suggestion', () => {
  // Browsing a crate with j/k must not enqueue a serial DSP job for every row the
  // user merely passed through: the probe waits until the selection rests.
  it('does not probe the tempo until the selection rests on the track', async () => {
    const bpm = vi.fn().mockResolvedValue({ bpm: 124, confidence: 0.8 })
    ;(window as unknown as { api: { bpm: unknown } }).api.bpm = bpm
    renderEditor({ id: 'a' }, 'wav', { visibleFields: ['bpm'] })
    await screen.findByTestId('field-bpm')
    expect(bpm).not.toHaveBeenCalled()
    await screen.findByTestId('chip-124')
    expect(bpm).toHaveBeenCalledTimes(1)
  })

  // Tempo detection can land on the wrong half/double-time octave, so the
  // detected value must stay a suggestion the user confirms — the chip click is
  // that confirmation; nothing writes the field unattended.
  it('offers the detected tempo as a chip that fills the bpm field on click', async () => {
    ;(window as unknown as { api: { bpm: unknown } }).api.bpm = vi
      .fn()
      .mockResolvedValue({ bpm: 123.97, confidence: 0.8 })
    const { onChange } = renderEditor({ id: 'a' }, 'wav', { visibleFields: ['bpm'] })
    // The tag layer stores whole beats per minute, so the chip offers the
    // rounded figure rather than the raw estimate.
    fireEvent.click(await screen.findByTestId('chip-124'))
    expect(onChange).toHaveBeenCalledWith({ meta: expect.objectContaining({ bpm: '124' }) })
  })

  // A beatless track measures null; suggesting a made-up tempo would be worse
  // than no suggestion, so no chip renders.
  it('shows no chip when no tempo was detected', async () => {
    ;(window as unknown as { api: { bpm: unknown } }).api.bpm = vi.fn().mockResolvedValue(null)
    renderEditor({ id: 'a' }, 'wav', { visibleFields: ['bpm'] })
    await screen.findByTestId('field-bpm')
    expect(screen.queryByTestId(/^chip-/)).not.toBeInTheDocument()
  })
})

describe('Editor key suggestion', () => {
  // Key detection is the least reliable analysis Surco runs, so the detected
  // value must stay a suggestion the user confirms — the chip click is that
  // confirmation; nothing writes the field unattended.
  it('offers the detected key as a Camelot chip by default and fills the field', async () => {
    ;(window as unknown as { api: { key: unknown } }).api.key = vi
      .fn()
      .mockResolvedValue({ camelot: '8A', name: 'Am', confidence: 0.8 })
    const { onChange } = renderEditor({ id: 'a' }, 'wav', { visibleFields: ['key'] })
    fireEvent.click(await screen.findByTestId('chip-8A'))
    expect(onChange).toHaveBeenCalledWith({ meta: expect.objectContaining({ key: '8A' }) })
  })

  // Classically-trained users read Am, not 8A; the Settings choice decides
  // which notation the chip offers (and therefore writes).
  it('offers the musical name when the setting says so', async () => {
    ;(window as unknown as { api: { key: unknown } }).api.key = vi
      .fn()
      .mockResolvedValue({ camelot: '8A', name: 'Am', confidence: 0.8 })
    renderEditor({ id: 'a' }, 'wav', { visibleFields: ['key'], keyNotation: 'musical' })
    expect(await screen.findByTestId('chip-Am')).toBeInTheDocument()
    expect(screen.queryByTestId('chip-8A')).not.toBeInTheDocument()
  })

  // Atonal material measures null; suggesting a key that would ruin a
  // harmonic mix is worse than no suggestion, so no chip renders.
  it('shows no chip when no key was detected', async () => {
    ;(window as unknown as { api: { key: unknown } }).api.key = vi.fn().mockResolvedValue(null)
    renderEditor({ id: 'a' }, 'wav', { visibleFields: ['key'] })
    await screen.findByTestId('field-key')
    expect(screen.queryByTestId(/^chip-/)).not.toBeInTheDocument()
  })
})

describe('Editor multi-select sequential edits', () => {
  it('keeps applying every shared-field edit to all tracks, not just the first', () => {
    renderWithQuery(<MultiHarness />)
    fireEvent.change(screen.getByTestId('field-year'), { target: { value: '1999' } })
    fireEvent.change(screen.getByTestId('field-genre'), { target: { value: 'House' } })
    // Both edits must land on both tracks; the bug report is the second one being dropped.
    expect(screen.getByTestId('dump')).toHaveTextContent('a:1999,House|b:1999,House')
  })
})

describe('Editor multi-select', () => {
  function renderMulti(
    opts: {
      done?: boolean
      platform?: string
      music?: boolean
      loudness?: boolean
      visibleFields?: string[]
    } = {},
  ) {
    if (opts.platform)
      (window as unknown as { api: { platform: string } }).api.platform = opts.platform
    const onChangeAllMeta = vi.fn()
    const onProcessAll = vi.fn()
    const onAddAllToAppleMusic = vi.fn()
    const onDeriveTags = vi.fn()
    const status = opts.done ? ('done' as const) : ('idle' as const)
    const a = item({
      id: 'a',
      fileName: 'kumara - one.flac',
      status,
      outputPath: opts.done ? '/out/a.aiff' : undefined,
      meta: { title: 'A', album: 'Shared' },
      spectrum: { image: '', cutoffHz: null, sampleRateHz: 44100, processed: false },
    })
    const b = item({
      id: 'b',
      fileName: 'cortina - two.flac',
      status,
      outputPath: opts.done ? '/out/b.aiff' : undefined,
      meta: { title: 'B', album: 'Shared' },
    })
    renderWithQuery(
      <Editor
        item={a}
        hasToken
        outputFormat="aiff"
        addToAppleMusic={opts.music ?? false}
        overwriteOriginal={false}
        keyNotation="camelot"
        groupingPresets={[]}
        genrePresets={[]}
        visibleFields={opts.visibleFields ?? ['title', 'album']}
        requiredFields={[]}
        discogsFormats={[]}
        showSpectrum
        showLoudness={opts.loudness ?? false}
        normalize={{ mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 }}
        searchInputRef={createRef<HTMLInputElement>()}
        selectedTracks={[a, b]}
        onApplyMatches={vi.fn()}
        onProcessAll={onProcessAll}
        onAddAllToAppleMusic={onAddAllToAppleMusic}
        onChangeAllMeta={onChangeAllMeta}
        onApplyCoverAll={vi.fn()}
        onDeriveTags={onDeriveTags}
        onChange={vi.fn()}
        onProcess={vi.fn()}
        onAddToAppleMusic={vi.fn()}
        onOpenSettings={vi.fn()}
        onShowLoudnessHelp={vi.fn()}
        onOpenRename={vi.fn()}
        onRegenerateName={vi.fn()}
        onCopyFilename={vi.fn()}
      />,
    )
    return { onChangeAllMeta, onProcessAll, onAddAllToAppleMusic, onDeriveTags }
  }

  // The spectrum and output filename describe a single file; over a multi-selection they
  // are meaningless, so they must drop out rather than show the primary track's by accident.
  it('hides the per-track spectrum and filename when several tracks are selected', () => {
    renderMulti()
    expect(screen.queryByText(i18n.t('editor.qualityTitle'))).toBeNull()
    expect(screen.queryByTestId('output-name')).toBeNull()
  })

  it('shows shared album fields and a convert-all action with the format picker', () => {
    renderMulti()
    expect(screen.getByTestId('field-album')).toHaveValue('Shared')
    expect(screen.queryByTestId('field-title')).toBeNull()
    // The convert button keeps the format split-control, but converts the whole selection.
    expect(screen.getByTestId('process-btn')).toHaveTextContent('Convert (2)')
    expect(screen.getByTestId('process-format-toggle')).toBeInTheDocument()
  })

  // The bulk form must honour the same visible-fields setting as the single editor:
  // a user who hid Composer or Catalog No. should not see them reappear just because
  // they selected two tracks.
  it('hides bulk fields the user has not made visible', () => {
    renderMulti()
    expect(screen.queryByTestId('field-composer')).toBeNull()
    expect(screen.queryByTestId('field-catalogNumber')).toBeNull()
    expect(screen.queryByTestId('field-publisher')).toBeNull()
    expect(screen.queryByTestId('field-year')).toBeNull()
  })

  it('converts every selected track in the chosen format', () => {
    const { onProcessAll } = renderMulti()
    fireEvent.click(screen.getByTestId('process-btn'))
    expect(onProcessAll).toHaveBeenCalledWith('aiff')
  })

  // Bulk edits write ONE value to every track, but each track's fields differ, so
  // "insert from another field" has no single honest value to offer — per-track
  // resolution is a future template feature, not this menu.
  it('offers no insert-from-field menu over a multi-selection', () => {
    renderMulti()
    expect(screen.queryByTestId('field-insert-album')).toBeNull()
  })

  // Multi-select hides the whole Quality section, so its loudness probe must not run:
  // it's a full-file ffmpeg EBU R128 pass whose result nothing would display.
  it('does not measure loudness while several tracks are selected', () => {
    const loudness = vi.fn().mockResolvedValue(null)
    ;(window as unknown as { api: Record<string, unknown> }).api.loudness = loudness
    renderMulti({ loudness: true })
    expect(loudness).not.toHaveBeenCalled()
  })

  // With the Apple Music setting on, the convert button must say so for the selection just
  // like the single-track button does, so the user knows the batch will be added too.
  it('shows the convert-all button includes Apple Music when the setting is on', () => {
    renderMulti({ platform: 'darwin', music: true })
    expect(screen.getByTestId('process-btn')).toHaveTextContent('Apple Music')
  })

  it('writes a shared-field edit to every selected track', () => {
    const { onChangeAllMeta } = renderMulti()
    fireEvent.change(screen.getByTestId('field-album'), { target: { value: 'New Album' } })
    expect(onChangeAllMeta).toHaveBeenCalledWith({ album: 'New Album' })
  })

  it('derives tags for every selected track from its own file name in one click', () => {
    const { onDeriveTags } = renderMulti()
    fireEvent.click(screen.getByTestId('derive-btn'))
    expect(onDeriveTags).toHaveBeenCalledWith([
      { id: 'a', meta: { artist: 'kumara', title: 'one' } },
      { id: 'b', meta: { artist: 'cortina', title: 'two' } },
    ])
  })

  // Composer, original year and the compilation flag are album-level facts, so
  // they belong in the shared form: marking a VA album as a compilation track by
  // track is exactly the chore multi-select exists to avoid.
  it('offers composer, original year and the compilation flag across the selection', () => {
    const { onChangeAllMeta } = renderMulti({
      visibleFields: ['title', 'album', 'composer', 'originalYear', 'compilation'],
    })
    expect(screen.getByTestId('field-composer')).toBeInTheDocument()
    expect(screen.getByTestId('field-originalYear')).toBeInTheDocument()
    const box = screen.getByTestId('field-compilation')
    expect(box).toHaveProperty('checked', false)
    fireEvent.click(box)
    expect(onChangeAllMeta).toHaveBeenCalledWith({ compilation: '1' })
  })

  // Clearing over a selection goes through the same shared-form channel as any
  // multi edit, so every selected track is emptied, not just the primary one.
  it('empties the metadata of every selected track in one click', () => {
    const { onChangeAllMeta } = renderMulti()
    fireEvent.click(screen.getByTestId('clear-meta-btn'))
    expect(onChangeAllMeta).toHaveBeenCalledWith(
      expect.objectContaining({ title: '', artist: '', album: '', genre: '', rating: '' }),
    )
  })

  // The same post-convert "Add to Apple Music" button is reused for the selection rather
  // than reimplemented, so once every track is converted it adds them all in one click.
  it('reuses the Apple Music button to add the whole selection once converted', () => {
    const { onAddAllToAppleMusic } = renderMulti({ done: true, platform: 'darwin' })
    fireEvent.click(screen.getByTestId('add-apple-music'))
    expect(onAddAllToAppleMusic).toHaveBeenCalled()
  })

  // The single-track outcome line names the format; over a selection that's
  // meaningless, so it reports how many tracks were exported instead.
  it('reports how many tracks were exported once the selection is done', () => {
    renderMulti({ done: true })
    expect(screen.getByTestId('export-success')).toHaveTextContent('2')
  })
})

describe('Editor export control', () => {
  // The original bug: once a track was done its export button vanished, so a user
  // who exported WAV had no way to also export MP3 without reloading the file.
  it('keeps the export button visible after the track is done', () => {
    renderEditor({ id: 'a', status: 'done', outputPath: '/out/a.wav' })
    expect(screen.getByTestId('process-btn')).toBeInTheDocument()
  })

  // Once done, the noise of four equal buttons is replaced by a single primary
  // action: the outcome line confirms what was written and "Show file" is the one
  // thing most users want next, so it earns the only prominent button.
  it('confirms the export outcome and reveals the file with the primary action', () => {
    renderEditor({ id: 'a', status: 'done', inputPath: '/music/a.flac', outputPath: '/out/a.wav' })
    expect(screen.getByTestId('export-success')).toHaveTextContent('WAV')
    fireEvent.click(screen.getByTestId('show-file'))
    expect(
      (window as unknown as { api: { reveal: ReturnType<typeof vi.fn> } }).api.reveal,
    ).toHaveBeenCalledWith('/out/a.wav')
  })

  // "Apple Music only" leaves no file in the output folder, so there is nothing to
  // reveal: the outcome must confirm the library add and drop the dead "Show file".
  it('confirms the Apple Music add without a Show file button when no copy was kept', () => {
    renderEditor({ id: 'a', status: 'done', musicStatus: 'added' })
    expect(screen.getByTestId('export-success')).toHaveTextContent('Apple Music')
    expect(screen.queryByTestId('show-file')).not.toBeInTheDocument()
    expect(screen.queryByTestId('add-apple-music')).not.toBeInTheDocument()
  })

  // A track whose add stored a persistent ID has a live copy in the library; offering
  // "Add" again would import a duplicate, so the same button must read as a sync.
  it('offers to update the library copy instead of re-adding when the track has one', () => {
    ;(window as unknown as { api: { platform: string } }).api.platform = 'darwin'
    renderEditor({
      id: 'a',
      status: 'done',
      outputPath: '/out/a.wav',
      musicPersistentId: 'ABCD1234',
    })
    expect(screen.getByTestId('add-apple-music')).toHaveTextContent('Update in Apple Music')
  })

  // Once the library copy is in sync, a disabled "Added ✓" is a dead end — the slot
  // becomes the reveal, jumping to this exact track in the Music window.
  it('turns the synced state into a "Show in Apple Music" action that reveals the library copy', () => {
    const revealAppleMusic = vi.fn().mockResolvedValue(undefined)
    const api = (window as unknown as { api: { platform: string; revealAppleMusic: unknown } }).api
    api.platform = 'darwin'
    api.revealAppleMusic = revealAppleMusic
    renderEditor({
      id: 'a',
      status: 'done',
      outputPath: '/out/a.wav',
      musicStatus: 'added',
      musicPersistentId: 'ABCD1234',
    })
    const btn = screen.getByTestId('add-apple-music')
    expect(btn).toHaveTextContent('Show in Apple Music')
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    expect(revealAppleMusic).toHaveBeenCalledWith('ABCD1234')
  })

  // In "Apple Music only" mode the footer used to hide the Apple Music button with the
  // converted file gone; with a persistent ID the sync needs no file, so the button
  // stays and the library copy remains reachable and updatable.
  it('keeps the Apple Music button without an output file once a persistent ID exists', () => {
    ;(window as unknown as { api: { platform: string } }).api.platform = 'darwin'
    renderEditor({ id: 'a', status: 'done', musicStatus: 'added', musicPersistentId: 'ABCD1234' })
    expect(screen.getByTestId('add-apple-music')).toBeInTheDocument()
  })

  it('exports in the settings default format when the main button is clicked', () => {
    const { onProcess } = renderEditor({ id: 'a' }, 'wav')
    fireEvent.click(screen.getByTestId('process-btn'))
    expect(onProcess).toHaveBeenCalledWith('wav')
  })

  // Exporting to the source's own format edits the original in place rather than
  // writing a converted copy, so the button must not promise a conversion that
  // never happens — it offers to update the file instead.
  it('labels the button "Update" when the export format matches the source', () => {
    renderEditor({ id: 'a', inputPath: '/music/a.wav' }, 'wav')
    expect(screen.getByTestId('process-btn')).toHaveTextContent('Update')
  })

  // Picking a format from the dropdown used to convert on the spot, so a misclick
  // wrote a file. The dropdown now only chooses the format; conversion waits for a
  // deliberate click on the main button.
  it('does not convert when a format is picked from the dropdown', () => {
    const { onProcess } = renderEditor({ id: 'a' }, 'wav')
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.click(screen.getByTestId('process-format-mp3'))
    expect(onProcess).not.toHaveBeenCalled()
  })

  it('relabels the main button to the format chosen from the dropdown', () => {
    renderEditor({ id: 'a' }, 'wav')
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.click(screen.getByTestId('process-format-mp3'))
    expect(screen.getByTestId('process-btn')).toHaveTextContent('MP3')
  })

  it('exports in the chosen format when the main button is clicked after picking it', () => {
    const { onProcess } = renderEditor({ id: 'a' }, 'wav')
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.click(screen.getByTestId('process-format-mp3'))
    fireEvent.click(screen.getByTestId('process-btn'))
    expect(onProcess).toHaveBeenCalledTimes(1)
    expect(onProcess).toHaveBeenCalledWith('mp3')
  })

  // The keyboard convert shortcuts (⌘⏎) live in App and only know the chosen
  // format through this callback, so picking one must report it up.
  // App mirrors the editor's picks in refs for the keyboard convert shortcuts. The
  // mount report is what keeps that mirror right by construction: the editor remounts
  // per track, so the seed lands without App watching the selection separately.
  it('reports the seeded format up on mount', () => {
    const { onFormatChange } = renderEditor({ id: 'a' }, 'wav')
    expect(onFormatChange).toHaveBeenCalledWith('wav')
  })

  it('reports the picked format so the keyboard shortcut can match it', () => {
    const { onFormatChange } = renderEditor({ id: 'a' }, 'wav')
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.click(screen.getByTestId('process-format-mp3'))
    expect(onFormatChange).toHaveBeenCalledWith('mp3')
  })
})

describe('Editor delete original', () => {
  // A real conversion leaves the source file untouched beside the converted copy,
  // so once a track is done the user can reclaim the disk by trashing the original
  // — the converted output (and its row) stays.
  it('offers to delete the original once a real conversion is done', () => {
    const { onTrashOriginal } = renderEditor({
      id: 'a',
      status: 'done',
      inputPath: '/music/a.wav',
      outputPath: '/out/a.aiff',
    })
    fireEvent.click(screen.getByTestId('delete-original'))
    expect(onTrashOriginal).toHaveBeenCalledTimes(1)
  })

  // An in-place export rewrites and renames the original, so inputPath now points at
  // the output: there is no separate original to delete, and offering it would trash
  // the only copy the user has.
  it('hides the delete-original button for an in-place export', () => {
    renderEditor({
      id: 'a',
      status: 'done',
      inputPath: '/out/a.wav',
      outputPath: '/out/a.wav',
    })
    expect(screen.queryByTestId('delete-original')).not.toBeInTheDocument()
  })

  // After the original is trashed the button has nothing left to act on, so it goes
  // away rather than letting a second click error on a missing file.
  it('hides the delete-original button once the original is trashed', () => {
    renderEditor({
      id: 'a',
      status: 'done',
      inputPath: '/music/a.wav',
      outputPath: '/out/a.aiff',
      originalTrashed: true,
    })
    expect(screen.queryByTestId('delete-original')).not.toBeInTheDocument()
  })
})

describe('Editor output file name', () => {
  // Users complained that loading a file and converting renamed it from metadata.
  // The field must default to the source file's own name, leaving any rename opt-in.
  it('defaults the output name to the original file name, not the metadata', () => {
    renderEditor(
      { id: 'a', fileName: 'original track 01', meta: { artist: 'AR', title: 'TI' } },
      'wav',
    )
    expect(screen.getByTestId('output-name')).toHaveValue('original track 01')
  })

  // Regenerate is the fast path: one click rebuilds the name from the Settings naming
  // pattern (App owns the format, so the click just signals intent) without a modal.
  it('regenerates the name in one click without opening the builder', () => {
    const { onOpenRename, onRegenerateName } = renderEditor(
      { id: 'a', fileName: 'original track 01', meta: { artist: 'AR', title: 'TI' } },
      'wav',
    )
    fireEvent.click(screen.getByTestId('regenerate-output-name'))
    expect(onRegenerateName).toHaveBeenCalled()
    expect(onOpenRename).not.toHaveBeenCalled()
  })

  // The pattern builder stays one button away for a per-track custom name, behind the
  // secondary ⋯ control so the common case (regenerate) is the prominent one.
  it('opens the pattern builder from the customize control', () => {
    const { onOpenRename, onRegenerateName } = renderEditor(
      { id: 'a', fileName: 'original track 01', meta: { artist: 'AR', title: 'TI' } },
      'wav',
    )
    fireEvent.click(screen.getByTestId('customize-output-name'))
    expect(onOpenRename).toHaveBeenCalled()
    expect(onRegenerateName).not.toHaveBeenCalled()
  })

  // Overwrite mode pins the name to the original, so editing it would be a lie — the
  // whole File Name section is replaced by a notice of what the export does instead.
  it('hides the File Name section and shows the overwrite notice in overwrite mode', () => {
    renderEditor({ id: 'a', fileName: 'original track 01' }, 'wav', { overwriteOriginal: true })
    expect(screen.queryByTestId('output-name')).toBeNull()
    expect(screen.getByTestId('overwrite-notice')).toBeInTheDocument()
  })

  // The one irreversible case — replacing a lossless master with MP3 — gets the louder
  // warning so the user isn't surprised that the original is gone.
  it('warns about losing the master when overwriting a lossless source with MP3', () => {
    renderEditor({ id: 'a', inputPath: '/music/a.wav' }, 'mp3', { overwriteOriginal: true })
    expect(screen.getByTestId('overwrite-hint')).toHaveTextContent(/master is lost/i)
  })

  // Overwriting MP3 with MP3, or any lossless target, is recoverable enough to skip the
  // sharper wording — the plain notice is shown.
  it('shows the plain notice when overwriting without losing quality', () => {
    renderEditor({ id: 'a', inputPath: '/music/a.wav' }, 'aiff', { overwriteOriginal: true })
    expect(screen.getByTestId('overwrite-hint')).not.toHaveTextContent(/master is lost/i)
  })
})

describe('Editor star rating', () => {
  it('sets the rating to the clicked star', () => {
    const { onChange } = renderEditor({ id: 'a' })
    fireEvent.click(screen.getByTestId('star-4'))
    expect(onChange).toHaveBeenCalledWith({ meta: expect.objectContaining({ rating: '4' }) })
  })

  // Clicking the highest filled star again clears the rating, so a misclick is undoable.
  it('clears the rating when the active star is clicked again', () => {
    const { onChange } = renderEditor({ id: 'a', meta: { rating: '3' } })
    fireEvent.click(screen.getByTestId('star-3'))
    expect(onChange).toHaveBeenCalledWith({ meta: expect.objectContaining({ rating: '' }) })
  })
})

describe('Editor required-field gate', () => {
  // The convert button used to fail late: it stayed enabled with empty required
  // fields and only surfaced the error after the click. Disabling it until the
  // fields are filled turns a dead-end error into clear, upfront guidance.
  it('disables both convert buttons while a required field is empty', () => {
    renderEditor({ id: 'a', meta: { artist: '' } }, 'wav', { requiredFields: ['artist'] })
    expect(screen.getByTestId('process-btn')).toBeDisabled()
    expect(screen.getByTestId('process-format-toggle')).toBeDisabled()
  })

  it('enables the convert button once every required field has a value', () => {
    renderEditor({ id: 'a', meta: { artist: 'Alex Ponce' } }, 'wav', {
      requiredFields: ['artist'],
    })
    expect(screen.getByTestId('process-btn')).toBeEnabled()
  })

  // The disabled button needs a reason: flag the empty required field as invalid
  // straight away, not only after a (now impossible) failed convert attempt.
  it('marks an empty required field as invalid before any convert attempt', () => {
    renderEditor({ id: 'a', status: 'idle', meta: { artist: '' } }, 'wav', {
      requiredFields: ['artist'],
      visibleFields: ['artist'],
    })
    expect(screen.getByTestId('field-artist')).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('Editor Discogs apply', () => {
  const searchResult = { id: 1, title: 'Some Album', cover_image: 'cover.jpg' }
  const release = {
    id: 1,
    title: 'Some Album',
    artists: [{ name: 'The Artist' }],
    tracklist: [
      { position: 'A1', title: 'Track One', duration: '3:21' },
      { position: 'A2', title: 'Track Two', duration: '7:45' },
    ],
  }

  function withDiscogs(): { getRelease: ReturnType<typeof vi.fn> } {
    const getRelease = vi.fn().mockResolvedValue(release)
    ;(window as unknown as { api: unknown }).api = {
      platform: 'win32',
      reveal: vi.fn(),
      properties: vi.fn().mockResolvedValue(null),
      hasClipboardImage: vi.fn().mockResolvedValue(false),
      onWindowFocus: vi.fn(() => () => {}),
      searchDiscogs: vi.fn().mockResolvedValue([searchResult]),
      getRelease,
    }
    return { getRelease }
  }

  async function search(): Promise<void> {
    fireEvent.change(screen.getByTestId('discogs-query'), { target: { value: 'some album' } })
    fireEvent.click(screen.getByTestId('discogs-search'))
    await screen.findByTestId('discogs-result')
  }

  // The album row used to apply its best-guess track on a hidden double-click,
  // silently overwriting the user's edits. Browsing results must never mutate the
  // song; loading the release (getRelease) only happens on a deliberate action.
  it('does not apply metadata when the album row is double-clicked', async () => {
    const { getRelease } = withDiscogs()
    renderEditor({ id: 'a' })
    await search()
    fireEvent.doubleClick(screen.getByTestId('discogs-result'))
    expect(getRelease).not.toHaveBeenCalled()
  })

  // The search field has only a placeholder, which screen readers don't treat as a
  // label, so it needs an explicit accessible name.
  it('gives the Discogs search field an accessible name', () => {
    withDiscogs()
    renderEditor({ id: 'a' })
    expect(screen.getByTestId('discogs-query')).toHaveAccessibleName()
  })

  // Long titles ("Clear Blue Water (Ferry Cor…") truncate in the narrow Discogs
  // column with no way to read the rest; the native title tooltip reveals the full
  // name on hover without adding any chrome to the row.
  it('reveals the full track title on hover via the native tooltip', async () => {
    withDiscogs()
    renderEditor({ id: 'a' })
    await search()
    fireEvent.click(screen.getByTestId('discogs-result'))
    const rows = await screen.findAllByTestId('discogs-track')
    expect(rows[0].querySelector('[data-fit]')).toHaveAttribute('title', 'Track One')
  })

  // The discoverable, explicit path: expand the album, then pick the track. That
  // single click is what applies the metadata.
  it('applies a track when it is picked from the expanded album', async () => {
    withDiscogs()
    const { onChange } = renderEditor({ id: 'a' })
    await search()
    fireEvent.click(screen.getByTestId('discogs-result'))
    fireEvent.click((await screen.findAllByTestId('discogs-track'))[0])
    expect(onChange).toHaveBeenCalled()
  })

  // Clicking the already-open album closes it again, so the row acts as a toggle
  // rather than only ever expanding.
  it('collapses the album when its open row is clicked again', async () => {
    withDiscogs()
    renderEditor({ id: 'a' })
    await search()
    fireEvent.click(screen.getByTestId('discogs-result'))
    expect((await screen.findAllByTestId('discogs-track')).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByTestId('discogs-result'))
    expect(screen.getByTestId('discogs-result')).toHaveAttribute('aria-expanded', 'false')
  })

  // After searching, the result that confidently holds the file's track opens on
  // its own, so the user lands on the right album without clicking each result.
  it('auto-opens the result whose tracklist matches the file', async () => {
    withDiscogs()
    renderEditor({ id: 'a', meta: { title: 'Track One' } })
    await search()
    expect((await screen.findAllByTestId('discogs-track')).length).toBeGreaterThan(0)
    expect(screen.getByTestId('discogs-result')).toHaveAttribute('aria-expanded', 'true')
  })

  // The probe is a guess that must never mutate the song — only opening the album
  // does. With no title there is nothing to match, so it doesn't even fetch.
  it('does not probe releases when the file has no title', async () => {
    const { getRelease } = withDiscogs()
    const { onChange } = renderEditor({ id: 'a' })
    await search()
    expect(getRelease).not.toHaveBeenCalled()
    // What must not happen is a metadata apply from a release that was never opened.
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ meta: expect.anything() }))
  })

  function withImages(): void {
    const withImage = {
      ...release,
      images: [{ uri: 'discogs.jpg', type: 'primary', resource_url: '' }],
    }
    ;(window as unknown as { api: unknown }).api = {
      platform: 'win32',
      reveal: vi.fn(),
      properties: vi.fn().mockResolvedValue(null),
      hasClipboardImage: vi.fn().mockResolvedValue(false),
      onWindowFocus: vi.fn(() => () => {}),
      prepareCoverDrag: () => Promise.resolve(null),
      searchDiscogs: vi.fn().mockResolvedValue([searchResult]),
      getRelease: vi.fn().mockResolvedValue(withImage),
    }
  }

  // The user's complaint these guard against: applying a release to fix text tags
  // must not throw away a good embedded cover. With a cover already present, picking
  // a track keeps it and ignores the release's image.
  it('keeps an existing cover when applying a release', async () => {
    withImages()
    const { onChange } = renderEditor({ id: 'a', coverUrl: 'embedded.jpg' })
    await search()
    fireEvent.click(screen.getByTestId('discogs-result'))
    fireEvent.click((await screen.findAllByTestId('discogs-track'))[0])
    expect(onChange.mock.calls.at(-1)?.[0].coverUrl).toBe('embedded.jpg')
  })

  // A low-res existing cover is the exception: it's replaced by the release image so
  // the track ends up with sharper art.
  it('replaces a low-res cover with the release image', async () => {
    withImages()
    const { onChange } = renderEditor({ id: 'a', coverUrl: 'tiny.jpg' })
    const img = screen.getByTestId('cover-preview')
    Object.defineProperty(img, 'naturalWidth', { value: 200, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: 200, configurable: true })
    fireEvent.load(img)
    await search()
    fireEvent.click(screen.getByTestId('discogs-result'))
    fireEvent.click((await screen.findAllByTestId('discogs-track'))[0])
    expect(onChange.mock.calls.at(-1)?.[0].coverUrl).toBe('discogs.jpg')
  })

  // A file with no embedded artwork must not contribute a phantom "file image" slot
  // to the cover picker. The cover it currently carries can be a leftover from an
  // earlier release match, so the picker has to list only the matched release's
  // images — a 3-image release reads "/3", never "/4".
  it('lists only the release images when the file has no embedded artwork', async () => {
    const threeImages = {
      ...release,
      images: [
        { uri: 'new1.jpg', type: 'primary', resource_url: '' },
        { uri: 'new2.jpg', type: 'secondary', resource_url: '' },
        { uri: 'new3.jpg', type: 'secondary', resource_url: '' },
      ],
    }
    ;(window as unknown as { api: unknown }).api = {
      platform: 'win32',
      reveal: vi.fn(),
      properties: vi.fn().mockResolvedValue(null),
      hasClipboardImage: vi.fn().mockResolvedValue(false),
      onWindowFocus: vi.fn(() => () => {}),
      prepareCoverDrag: () => Promise.resolve(null),
      searchDiscogs: vi.fn().mockResolvedValue([searchResult]),
      getRelease: vi.fn().mockResolvedValue(threeImages),
    }
    renderEditor({ id: 'a', coverUrl: 'old-release.jpg' })
    await search()
    fireEvent.click(screen.getByTestId('discogs-result'))
    await screen.findAllByTestId('discogs-track')
    expect(screen.getByTestId('cover-image-count').textContent).toMatch(/\/3$/)
  })

  // The lightbox covers the screen, so the well's inline arrows are out of reach
  // while it's open: it has to step through the choices itself, and (like the well's
  // stepper) committing live means closing on an image leaves it as the cover.
  it('steps through the cover choices from inside the lightbox', async () => {
    withImages()
    const { onChange } = renderEditor({
      id: 'a',
      coverUrl: 'embedded.jpg',
      embeddedCover: 'embedded.jpg',
    })
    await search()
    fireEvent.click(screen.getByTestId('discogs-result'))
    await screen.findAllByTestId('discogs-track')
    fireEvent.click(screen.getByTestId('cover-zoom'))
    expect(screen.getByTestId('cover-lightbox-count').textContent).toBe('1/2')
    fireEvent.click(screen.getByTestId('cover-lightbox-next'))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ coverUrl: 'discogs.jpg', coverRemoved: false }),
    )
  })

  // Discogs returns each track's length; showing it next to the title is what lets
  // the user match the rip they have against the right tracklist entry by time.
  it('shows each track length from the Discogs tracklist', async () => {
    withDiscogs()
    renderEditor({ id: 'a' })
    await search()
    fireEvent.click(screen.getByTestId('discogs-result'))
    const rows = await screen.findAllByTestId('discogs-track')
    expect(rows[0]).toHaveTextContent('3:21')
    expect(rows[1]).toHaveTextContent('7:45')
  })
})

describe('Editor track preselection', () => {
  const searchResult = { id: 2, title: 'Some Album', cover_image: 'cover.jpg' }
  const release = {
    id: 2,
    title: 'Some Album',
    artists: [{ name: 'The Artist' }],
    tracklist: [
      { position: 'A1', title: 'Track One' },
      { position: 'A2', title: 'Track Two (Remix)' },
    ],
  }

  function withDiscogs(): void {
    ;(window as unknown as { api: unknown }).api = {
      platform: 'win32',
      reveal: vi.fn(),
      properties: vi.fn().mockResolvedValue(null),
      hasClipboardImage: vi.fn().mockResolvedValue(false),
      onWindowFocus: vi.fn(() => () => {}),
      searchDiscogs: vi.fn().mockResolvedValue([searchResult]),
      getRelease: vi.fn().mockResolvedValue(release),
    }
  }

  async function loadTracklist(): Promise<HTMLElement[]> {
    fireEvent.change(screen.getByTestId('discogs-query'), { target: { value: 'some album' } })
    fireEvent.click(screen.getByTestId('discogs-search'))
    fireEvent.click(await screen.findByTestId('discogs-result'))
    return screen.findAllByTestId('discogs-track')
  }

  // The file's title rarely matches the Discogs spelling exactly — punctuation and
  // case differ — so an exact compare would highlight nothing. The fuzzy match
  // preselects the right mix from the filename so the user doesn't hunt for it.
  it('preselects the tracklist entry that best matches the file title', async () => {
    withDiscogs()
    renderEditor({ id: 'a', meta: { title: 'track two remix' } })
    const rows = await loadTracklist()
    const remix = rows.find((r) => r.textContent?.includes('Track Two (Remix)'))
    const other = rows.find((r) => r.textContent?.includes('Track One'))
    expect(remix).toHaveAttribute('aria-current', 'true')
    expect(other).not.toHaveAttribute('aria-current')
  })

  // A confident preselection (exact title) and a shakier one (a partial match)
  // should not look the same: the badge tells the user whether to trust the
  // highlight or double-check it, which is what makes a batch auto-match safe.
  it('marks an exact-title preselection as a confident match', async () => {
    withDiscogs()
    renderEditor({ id: 'a', meta: { title: 'track two remix' } })
    await loadTracklist()
    expect(await screen.findByTestId('track-confidence')).toHaveAttribute('data-confidence', 'high')
  })

  // A check icon reads as "already applied", but nothing is applied until the
  // user clicks the row — so the suggestion must be a plain text label ("Suggested"),
  // not a tick, otherwise the user assumes the metadata is already filled in.
  it('labels the preselection as a suggestion rather than showing an applied-looking tick', async () => {
    withDiscogs()
    renderEditor({ id: 'a', meta: { title: 'track two remix' } })
    await loadTracklist()
    const badge = await screen.findByTestId('track-confidence')
    expect(badge.tagName).toBe('SPAN')
    expect(badge).toHaveTextContent(i18n.t('editor.matchSuggested'))
  })

  it('flags a partial-title preselection for review', async () => {
    withDiscogs()
    renderEditor({ id: 'a', meta: { title: 'track two' } })
    await loadTracklist()
    expect(await screen.findByTestId('track-confidence')).toHaveAttribute(
      'data-confidence',
      'review',
    )
  })

  // A weak match — one incidental shared word — is "too weak to trust", so it must
  // neither preselect a row nor show a badge. Otherwise loading an unrelated release
  // still badges a random mix and invites the user to apply the wrong one.
  it('does not preselect or badge a low-confidence match', async () => {
    withDiscogs()
    renderEditor({ id: 'a', meta: { title: 'track elsewhere entirely' } })
    const rows = await loadTracklist()
    expect(rows.some((r) => r.getAttribute('aria-current') === 'true')).toBe(false)
    expect(screen.queryByTestId('track-confidence')).toBeNull()
  })
})

describe('Editor in-place hint', () => {
  // A WAV source exported as WAV is edited (and renamed) in place; the user should
  // know the original file changes rather than a copy appearing in the output folder.
  it('warns about the in-place edit when the format matches the source', () => {
    renderEditor({ id: 'a', inputPath: '/music/a.wav' }, 'wav')
    expect(screen.getByTestId('output-name-hint')).toHaveTextContent(
      i18n.t('editor.outputNameHintInPlace'),
    )
  })

  // The default case needs no caption — users already know the pattern lives in
  // Settings — so the slot stays empty and the rare in-place warning stands out more.
  it('shows no hint when the export converts to a different format', () => {
    renderEditor({ id: 'a', inputPath: '/music/a.wav' }, 'mp3')
    expect(screen.queryByTestId('output-name-hint')).toBeNull()
  })
})

describe('Editor properties panel', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  const properties: TrackProperties = {
    codec: 'pcm_s16le',
    container: 'wav',
    sampleRateHz: 44100,
    bitDepth: 16,
    channels: 2,
    bitrateKbps: 1411,
    sizeBytes: 58_400_000,
    createdMs: 1_700_000_000_000,
    modifiedMs: 1_700_000_500_000,
    tagFormats: ['ID3v2.3', 'INFO'],
  }

  // The facts come from the main-process probe (window.api.properties) the panel runs
  // on mount, so each test seeds what that probe returns for this file.
  function seedProperties(value: TrackProperties | null): void {
    ;(window as unknown as { api: { properties: unknown } }).api.properties = vi
      .fn()
      .mockResolvedValue(value)
  }

  // Folded by default so the read-only facts never push the editing fields the user
  // came for down the panel; they open it deliberately to inspect the source.
  it('stays folded until the user opens it', () => {
    seedProperties(properties)
    renderEditor({ id: 'a' })
    expect(screen.queryByTestId('properties-readout')).not.toBeInTheDocument()
  })

  // The panel exists to surface the technical facts ffprobe reads off the source —
  // formatted for a human (kHz, Bit, kbps, MB), not raw — so a DJ can vet a rip.
  it('renders the probed audio facts once expanded', async () => {
    seedProperties(properties)
    renderEditor({ id: 'a' })
    fireEvent.click(screen.getByRole('button', { name: 'Properties' }))
    expect(await screen.findByTestId('property-sampleRate')).toHaveTextContent('44.1 kHz')
    expect(screen.getByTestId('property-bitDepth')).toHaveTextContent('16 Bit')
    expect(screen.getByTestId('property-channelMode')).toHaveTextContent('Stereo')
    expect(screen.getByTestId('property-bitrate')).toHaveTextContent('1411 kbps')
    expect(screen.getByTestId('property-size')).toHaveTextContent('55.7 MB')
    expect(screen.getByTestId('property-tagFormats')).toHaveTextContent('ID3v2.3, INFO')
  })

  // A lossy source has no fixed bit depth (probe leaves it null); the row must drop
  // out rather than print "0 Bit" / an empty value.
  it('omits the bit-depth row when the probe could not read one', async () => {
    seedProperties({ ...properties, bitDepth: null })
    renderEditor({ id: 'a' })
    fireEvent.click(screen.getByRole('button', { name: 'Properties' }))
    await screen.findByTestId('property-sampleRate')
    expect(screen.queryByTestId('property-bitDepth')).not.toBeInTheDocument()
  })

  // An untagged or unrecognized file sniffs no formats; the row must drop out rather
  // than render an empty "Tag formats:" line.
  it('omits the tag-formats row when none were recognized', async () => {
    seedProperties({ ...properties, tagFormats: [] })
    renderEditor({ id: 'a' })
    fireEvent.click(screen.getByRole('button', { name: 'Properties' }))
    await screen.findByTestId('property-sampleRate')
    expect(screen.queryByTestId('property-tagFormats')).not.toBeInTheDocument()
  })

  // The full path is too long for the row, so Location collapses to the containing
  // folder name and clicking it opens that folder in Finder — the user's quickest
  // route from "which track is this" to the file on disk.
  it('reveals the containing folder in Finder from the Location row', async () => {
    seedProperties(properties)
    renderEditor({ id: 'a', inputPath: '/Music/Crate/Vol 2/track.wav' })
    fireEvent.click(screen.getByRole('button', { name: 'Properties' }))
    const reveal = await screen.findByTestId('property-reveal')
    expect(reveal).toHaveTextContent('Vol 2')
    // The button reads as a path; its name must also say what activating it does.
    expect(reveal).toHaveAccessibleName(/reveal/i)
    fireEvent.click(reveal)
    expect(
      (window as unknown as { api: { reveal: ReturnType<typeof vi.fn> } }).api.reveal,
    ).toHaveBeenCalledWith('/Music/Crate/Vol 2/track.wav')
  })
})

describe('Editor Apple Music library badge', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  function setApi(platform: string, found: boolean): void {
    ;(window as unknown as { api: unknown }).api = {
      platform,
      reveal: vi.fn(),
      properties: vi.fn().mockResolvedValue(null),
      hasClipboardImage: vi.fn().mockResolvedValue(false),
      onWindowFocus: vi.fn(() => () => {}),
      lookupAppleMusic: vi.fn().mockResolvedValue(found),
    }
  }

  // The badge exists so a DJ doesn't re-import a song they already own; on macOS it
  // checks the live title/artist against the library and flags a match.
  it('flags a track already in the Apple Music library on macOS', async () => {
    setApi('darwin', true)
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } })
    expect(await screen.findByTestId('apple-music-status')).toHaveTextContent(
      'Already in your Apple Music library',
    )
  })

  // The complement: a song not found in the library reassures the user it's safe to add.
  it('flags a track that is not in the library', async () => {
    setApi('darwin', false)
    renderEditor({ id: 'a', meta: { title: 'Unknown', artist: 'Nobody' } })
    expect(await screen.findByTestId('apple-music-status')).toHaveTextContent(
      'Not in your Apple Music library',
    )
  })

  // While the lookup is in flight the slot holds a skeleton instead of unmounting,
  // so the header doesn't reflow when the verdict lands.
  it('holds a skeleton in the badge slot while the lookup is in flight', () => {
    setApi('darwin', true)
    ;(window as unknown as { api: { lookupAppleMusic: unknown } }).api.lookupAppleMusic = vi
      .fn()
      .mockReturnValue(new Promise(() => {}))
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } })
    expect(screen.getByTestId('apple-music-skeleton')).toBeInTheDocument()
    expect(screen.queryByTestId('apple-music-status')).toBeNull()
  })

  // The badge comes and goes with the lookup; rendering it before the
  // "Fill from filename" button keeps that button anchored at the header's edge.
  it('renders the badge before the fill-from-filename button', async () => {
    setApi('darwin', true)
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } })
    const badge = await screen.findByTestId('apple-music-status')
    const derive = screen.getByTestId('derive-btn')
    expect(badge.compareDocumentPosition(derive) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // Off macOS there is no Apple Music library to query, so the lookup never runs and
  // the badge stays hidden rather than making a promise the platform can't keep.
  it('never queries or shows the badge off macOS', async () => {
    setApi('win32', true)
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } })
    await Promise.resolve()
    expect(screen.queryByTestId('apple-music-status')).toBeNull()
    expect(
      (window as unknown as { api: { lookupAppleMusic: ReturnType<typeof vi.fn> } }).api
        .lookupAppleMusic,
    ).not.toHaveBeenCalled()
  })

  // The tags may still hold the filename's rough spelling while Discogs already
  // points at the canonical track; looking the suggestion up too catches a library
  // copy stored under the canonical name that the raw tags alone would miss.
  it('also looks up the Discogs-suggested track so a library copy under the canonical title is caught', async () => {
    const lookup = vi.fn().mockResolvedValue(false)
    ;(window as unknown as { api: unknown }).api = {
      platform: 'darwin',
      reveal: vi.fn(),
      properties: vi.fn().mockResolvedValue(null),
      hasClipboardImage: vi.fn().mockResolvedValue(false),
      onWindowFocus: vi.fn(() => () => {}),
      lookupAppleMusic: lookup,
      searchDiscogs: vi.fn().mockResolvedValue([{ id: 2, title: 'The Artist - Some Album' }]),
      getRelease: vi.fn().mockResolvedValue({
        id: 2,
        title: 'Some Album',
        artists: [{ name: 'The Artist' }],
        tracklist: [
          { position: 'A1', title: 'Track One' },
          { position: 'A2', title: 'Track Two (Remix)' },
        ],
      }),
    }
    renderEditor({ id: 'a', meta: { title: 'track two remix', artist: 'The Artist' } })
    fireEvent.change(screen.getByTestId('discogs-query'), { target: { value: 'some album' } })
    fireEvent.click(screen.getByTestId('discogs-search'))
    // The auto-probe opens the matching release on its own; once its tracklist is
    // on screen the lookup must re-run with the suggestion as a second candidate.
    await screen.findAllByTestId('discogs-track')
    await waitFor(
      () =>
        expect(lookup).toHaveBeenCalledWith([
          { artist: 'The Artist', title: 'track two remix' },
          { artist: 'The Artist', title: 'Track Two (Remix)' },
        ]),
      { timeout: 3000 },
    )
  })
})

describe('Editor insert from field', () => {
  // The menu exists to compose one field out of the others ("title + year")
  // without retyping; offering the field's own value or empty fields would
  // only be noise, so both are filtered out.
  it('inserts another visible field value into the edited field', () => {
    const { onChange } = renderEditor(
      { id: 't1', meta: { title: 'Pepito de los palotes', year: '2025' } },
      'wav',
      { visibleFields: ['title', 'artist', 'year'] },
    )
    fireEvent.click(screen.getByTestId('field-insert-title'))
    expect(screen.queryByTestId('field-insert-option-title')).toBeNull()
    expect(screen.queryByTestId('field-insert-option-artist')).toBeNull()
    fireEvent.click(screen.getByTestId('field-insert-option-year'))
    expect(onChange).toHaveBeenCalledWith({
      meta: expect.objectContaining({ title: 'Pepito de los palotes2025' }),
    })
  })

  // Formatting needs no other filled field: with nothing to insert the trigger
  // stays and the menu offers only the case transforms.
  it('offers only the case transforms when no other visible field has a value', () => {
    renderEditor({ id: 't1', meta: { title: 'PEPITO DE LOS PALOTES' } }, 'wav', {
      visibleFields: ['title', 'year'],
    })
    fireEvent.click(screen.getByTestId('field-insert-title'))
    expect(screen.queryByTestId('field-insert-option-year')).toBeNull()
    expect(screen.getByTestId('field-insert-option-case-title')).toBeInTheDocument()
  })

  // Structured fields (year, BPM, key, track numbers…) hold single validated
  // values — composing into them would produce garbage like "20252025" — so only
  // free-text fields offer the menu, while every field still acts as a source.
  it('offers the menu only on free-text fields, never on structured ones', () => {
    renderEditor({ id: 't1', meta: { title: 'Pepito de los palotes', year: '2025' } }, 'wav', {
      visibleFields: ['title', 'year'],
    })
    expect(screen.getByTestId('field-insert-title')).toBeInTheDocument()
    expect(screen.queryByTestId('field-insert-year')).toBeNull()
  })
})

describe('Editor Discogs format filter hint', () => {
  // When a format filter is active (Settings → Search), the Discogs column says so, so a
  // thinned or empty result list reads as the filter at work rather than a broken search.
  it('shows which formats results are limited to when a filter is set', () => {
    renderEditor({ id: 'a' }, 'wav', { discogsFormats: ['Vinyl', 'CD'] })
    const hint = screen.getByTestId('discogs-format-filter')
    expect(hint).toHaveTextContent('Vinyl')
    expect(hint).toHaveTextContent('CD')
  })

  it('shows no format hint when no filter is set', () => {
    renderEditor({ id: 'a' }, 'wav', { discogsFormats: [] })
    expect(screen.queryByTestId('discogs-format-filter')).toBeNull()
  })
})
