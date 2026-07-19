// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { createRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  KeyNotation,
  LoudnessResult,
  NormalizeConfig,
  OutputFormat,
  Settings,
  TrackMetadata,
  TrackProperties,
} from '../../../shared/types'
import { resetEditorSections } from '../hooks/useEditorSections'
import i18n from '../i18n'
import { type AppleMusicIndex, buildLibraryIndex } from '../lib/appleMusicLibrary'
import { createQueryClient } from '../lib/queryClient'
import { SettingsProvider } from '../lib/settingsContext'
import type { TrackItem } from '../types'
import { Editor } from './Editor'

afterEach(cleanup)

// The Editor's read-only data (currently Properties) is fetched through React Query,
// so every mount needs a client in context. A fresh client per render keeps tests
// isolated; retry:false lets a rejected probe settle into isError within waitFor.
function renderWithQuery(
  ui: React.ReactElement,
  settings: Partial<Settings> = {},
): ReturnType<typeof render> {
  const client = createQueryClient()
  // The editor reads its Settings-derived values from the shared context now, so the
  // per-test overrides ride a provider instead of an 17-prop wall on <Editor>.
  return render(
    <QueryClientProvider client={client}>
      <SettingsProvider settings={{ discogsToken: 'tok', showSpectrum: false, ...settings }}>
        {ui}
      </SettingsProvider>
    </QueryClientProvider>,
  )
}

// Editor mounts effects that touch window.api; a non-darwin platform skips the
// Apple Music lookup and showSpectrum={false} skips the spectrogram analysis, so
// the bridge only needs `platform` and the handful of methods used on click.
beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    platform: 'win32',
    clicks: vi.fn().mockResolvedValue(null),
    // The repair section subscribes to render progress on mount, so the bridge
    // must hand back an unsubscribe even in tests that never open it.
    onDeclickPreviewProgress: vi.fn().mockReturnValue(() => {}),
    cancelDeclickPreview: vi.fn().mockResolvedValue(undefined),
    reveal: vi.fn(),
    recordStat: vi.fn(),
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
    addToAppleMusic?: boolean
    addToEngineDj?: boolean
    keyNotation?: KeyNotation
    discogsFormats?: string[]
    libraryIndex?: AppleMusicIndex | null
    replaceLowResCover?: boolean
    autoApplyFilename?: boolean
    filenameFormat?: string
    titleFormat?: string
    outputBitDepth?: Settings['outputBitDepth']
    outputSampleRate?: Settings['outputSampleRate']
    editorSections?: Settings['editorSections']
  } = {},
): {
  onProcess: ReturnType<typeof vi.fn>
  onReencode: ReturnType<typeof vi.fn>
  onChange: ReturnType<typeof vi.fn>
  onDeriveTags: ReturnType<typeof vi.fn>
  onApplyTitleFormat: ReturnType<typeof vi.fn>
  onFormatChange: ReturnType<typeof vi.fn>
  onTrashOriginal: ReturnType<typeof vi.fn>
  onRemoveOldMusicCopy: ReturnType<typeof vi.fn>
  onOpenSettings: ReturnType<typeof vi.fn>
  onShowLoudnessHelp: ReturnType<typeof vi.fn>
  onOpenRename: ReturnType<typeof vi.fn>
  onRegenerateName: ReturnType<typeof vi.fn>
  onCopyFilename: ReturnType<typeof vi.fn>
  onSearchWeb: ReturnType<typeof vi.fn>
  onExportCollection: ReturnType<typeof vi.fn>
} {
  const onProcess = vi.fn()
  const onReencode = vi.fn()
  const onChange = vi.fn()
  const onDeriveTags = vi.fn()
  const onApplyTitleFormat = vi.fn()
  const onFormatChange = vi.fn()
  const onTrashOriginal = vi.fn()
  const onRemoveOldMusicCopy = vi.fn()
  const onOpenSettings = vi.fn()
  const onShowLoudnessHelp = vi.fn()
  const onOpenRename = vi.fn()
  const onRegenerateName = vi.fn()
  const onCopyFilename = vi.fn()
  const onSearchWeb = vi.fn()
  const onExportCollection = vi.fn()
  renderWithQuery(
    <Editor
      item={item(over)}
      libraryIndex={props.libraryIndex ?? null}
      searchInputRef={createRef<HTMLInputElement>()}
      onChange={onChange}
      onProcess={onProcess}
      onReencode={onReencode}
      onFormatChange={onFormatChange}
      onDeriveTags={onDeriveTags}
      onApplyTitleFormat={onApplyTitleFormat}
      onAddToAppleMusic={vi.fn()}
      onTrashOriginal={onTrashOriginal}
      onRemoveOldMusicCopy={onRemoveOldMusicCopy}
      onOpenSettings={onOpenSettings}
      onResultsWidthChange={vi.fn()}
      onShowLoudnessHelp={onShowLoudnessHelp}
      onOpenRename={onOpenRename}
      onRegenerateName={onRegenerateName}
      onTrimDetectedAll={vi.fn()}
      onCopyFilename={onCopyFilename}
      onSearchWeb={onSearchWeb}
      onExportCollection={onExportCollection}
    />,
    {
      outputFormat,
      // The membership badge follows the conversion destination now; Apple Music (the
      // pre-destination-aware behaviour every badge test was written against) unless a
      // test opts into another destination.
      addToAppleMusic: props.addToAppleMusic ?? true,
      addToEngineDj: props.addToEngineDj ?? false,
      overwriteOriginal: props.overwriteOriginal ?? false,
      replaceLowResCover: props.replaceLowResCover ?? false,
      autoApplyFilename: props.autoApplyFilename ?? false,
      filenameFormat: props.filenameFormat ?? '{artist} - {title}',
      titleFormat: props.titleFormat ?? '',
      genrePresets: props.genrePresets ?? [],
      groupingPresets: [],
      visibleFields: props.visibleFields ?? [],
      requiredFields: props.requiredFields ?? [],
      discogsFormats: props.discogsFormats ?? [],
      discogsMaxResults: 25,
      showLoudness: props.showLoudness ?? false,
      keyNotation: props.keyNotation ?? 'camelot',
      normalize: props.normalize ?? { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
      outputBitDepth: props.outputBitDepth ?? 'source',
      outputSampleRate: props.outputSampleRate ?? 'source',
      ...(props.editorSections ? { editorSections: props.editorSections } : {}),
    },
  )
  return {
    onProcess,
    onReencode,
    onChange,
    onExportCollection,
    onDeriveTags,
    onApplyTitleFormat,
    onFormatChange,
    onTrashOriginal,
    onRemoveOldMusicCopy,
    onOpenSettings,
    onShowLoudnessHelp,
    onOpenRename,
    onRegenerateName,
    onCopyFilename,
    onSearchWeb,
  }
}

// Djotas' ask: same-format processing stays a metadata-only update, and when the
// source misses the pinned quality the editor offers the re-encode EXPLICITLY —
// a passive line plus an action, never a silent conversion.
describe('Editor re-encode offer', () => {
  const flacProps = (sampleRateHz: number, bitDepth: number | null = 24) => ({
    codec: 'flac',
    container: 'flac',
    sampleRateHz,
    bitDepth,
    channels: 2,
    bitrateKbps: null,
    sizeBytes: 1,
    createdMs: null,
    modifiedMs: null,
    tagFormats: [],
  })

  it('offers an explicit re-encode when a same-format source misses the pinned rate', async () => {
    ;(window.api as unknown as Record<string, unknown>).properties = vi
      .fn()
      .mockResolvedValue(flacProps(96000))
    const { onReencode } = renderEditor(
      { id: 'a', inputPath: '/music/a.flac', fileName: 'a.flac' },
      'flac',
      { outputSampleRate: '48000' },
    )
    expect(await screen.findByTestId('reencode-offer')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('reencode-action'))
    expect(onReencode).toHaveBeenCalledWith('flac')
  })

  it('stays silent when no pins are set — same-format remains a metadata-only update', () => {
    renderEditor({ id: 'a', inputPath: '/music/a.flac', fileName: 'a.flac' }, 'flac')
    expect(screen.queryByTestId('reencode-offer')).toBeNull()
  })

  it('stays silent when the source already meets the pins', async () => {
    const properties = vi.fn().mockResolvedValue(flacProps(48000))
    ;(window.api as unknown as Record<string, unknown>).properties = properties
    renderEditor({ id: 'a', inputPath: '/music/a.flac', fileName: 'a.flac' }, 'flac', {
      outputSampleRate: '48000',
    })
    await waitFor(() => expect(properties).toHaveBeenCalled())
    expect(screen.queryByTestId('reencode-offer')).toBeNull()
  })
})

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

describe('Editor search web', () => {
  // Copy-then-paste-into-Google was the manual chore the copy button left behind; this
  // one-click twin opens the search itself. App owns the pattern and the browser hand-off,
  // so the button just signals intent.
  it('searches the web for the file name in one click', () => {
    const { onSearchWeb } = renderEditor({ id: 'a' })
    fireEvent.click(screen.getByTestId('search-web-btn'))
    expect(onSearchWeb).toHaveBeenCalledTimes(1)
  })
})

describe('Editor clear metadata', () => {
  // The inverse of the fill controls (filename / Discogs): one click empties every
  // field so the user can retag a badly-labelled file from scratch instead of
  // deleting fifteen values by hand. "Clear" means the whole tag: the cover
  // (coverRemoved) and the rating (metaCleared) go too, not only the text fields.
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
        mood: '',
        energy: '',
      },
      matched: false,
      // Clearing the tags also drops any pending review flag, so a retag is probed afresh.
      matchReview: false,
      matchProvider: undefined,
      // ...and the Discogs-proven "owned" verdict, so it re-resolves against the retag.
      inLibraryResolved: false,
      // The whole tag goes, not just text: cover stripped and rating wiped on convert.
      coverRemoved: true,
      metaCleared: true,
      foreignRemoved: [],
    })
  })

  // Clearing must also drop the third-party tags the app doesn't manage (Serato/Traktor
  // cues) so the export strips them too, not just the fields the editor renders.
  it('borrar todo marca cada tag foráneo como eliminado', () => {
    const { onChange } = renderEditor({
      id: 'a',
      foreignTags: [
        { name: 'SERATO_MARKERS_V2', value: 'x' },
        { name: 'TRAKTOR4', value: 'y' },
      ],
    })
    fireEvent.click(screen.getByTestId('clear-meta-btn'))
    const patch = onChange.mock.calls.at(-1)?.[0]
    expect(patch.foreignRemoved).toEqual(['SERATO_MARKERS_V2', 'TRAKTOR4'])
    expect(patch.metaCleared).toBe(true)
  })
})

describe('Editor field edit after clear', () => {
  // "Clear" must survive typing: the bug this guards against had every field edit
  // resetting metaCleared to false, so filling in even one field after clearing
  // silently cancelled the clear and export re-copied the original's foreign tags.
  it('keeps metaCleared set after editing a field', () => {
    const { onChange } = renderEditor({ id: 'a', metaCleared: true }, 'wav', {
      visibleFields: ['title'],
    })
    const title = screen.getByTestId('field-title')
    fireEvent.change(title, { target: { value: 'New Title' } })
    fireEvent.blur(title)
    const patch = onChange.mock.calls.at(-1)?.[0]
    expect(patch).not.toHaveProperty('metaCleared', false)
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
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ compilation: '1' }) }),
    )
  })

  it('unticks back to an empty value, clearing the tag on the next write', () => {
    const { onChange } = renderEditor({ id: 'a', meta: { compilation: '1' } }, 'wav', {
      visibleFields: ['compilation'],
    })
    const box = screen.getByTestId('field-compilation')
    expect(box).toHaveProperty('checked', true)
    fireEvent.click(box)
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ compilation: '' }) }),
    )
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
        libraryIndex={null}
        searchInputRef={createRef<HTMLInputElement>()}
        onExportCollection={vi.fn()}
        onResultsWidthChange={vi.fn()}
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
        onTrimDetectedAll={vi.fn()}
        onCopyFilename={vi.fn()}
        onSearchWeb={vi.fn()}
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
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ genre: 'Hard Dance' }) }),
    )
  })
})

describe('Editor Discogs loading skeleton', () => {
  // While the search round-trips, the results column held only the static "choose an
  // album" hint — indistinguishable from "nothing happening". Skeleton rows hold the
  // column's shape so the results don't pop into an area that looked idle.
  it('holds the results column with a skeleton while the search is in flight', async () => {
    let settle: (r: unknown[]) => void = () => {}
    const search = vi.fn(
      () =>
        new Promise((res) => {
          settle = res
        }),
    )
    ;(window as unknown as { api: Record<string, unknown> }).api.search = search
    renderEditor({ id: 'a', query: 'artist song' })

    expect(await screen.findByTestId('discogs-skeleton')).toBeInTheDocument()

    // The skeleton can flip on a render tick before the query fn actually invokes the
    // mock (React Query marks fetching first, runs the fn a task later). Settling in
    // that gap fires the placeholder no-op and the real promise then hangs forever —
    // the CI-only flake this wait closes.
    await waitFor(() => expect(search).toHaveBeenCalled())
    settle([])
    await waitFor(() => expect(screen.queryByTestId('discogs-skeleton')).toBeNull())
  })

  // After ⌘2 lands focus in this column, choosing a release must be keyboard-only: ↓ from
  // the search box dives into the results, ↑/↓ rove between them, and ↑ off the top row
  // returns to the search box. (Enter/Space activation stays the buttons' own native job.)
  it('roves the search results with the arrow keys for a keyboard-only pick', async () => {
    ;(window as unknown as { api: Record<string, unknown> }).api.search = vi.fn(async () => [
      { provider: 'discogs', id: 1, title: 'First Release' },
      { provider: 'discogs', id: 2, title: 'Second Release' },
    ])
    renderEditor({ id: 'a', query: 'artist song' })
    const results = await screen.findAllByTestId('discogs-result')
    expect(results).toHaveLength(2)

    const search = screen.getByTestId('discogs-query')
    search.focus()
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(results[0]).toHaveFocus()

    fireEvent.keyDown(results[0], { key: 'ArrowDown' })
    expect(results[1]).toHaveFocus()

    fireEvent.keyDown(results[1], { key: 'ArrowUp' })
    expect(results[0]).toHaveFocus()

    fireEvent.keyDown(results[0], { key: 'ArrowUp' })
    expect(search).toHaveFocus()
  })

  // j/k mirror ↑/↓ inside this column (matching the track list's vim aliases) instead of
  // leaking to the global handler and moving the list behind the column being browsed.
  it('roves the results with the j/k vim keys too', async () => {
    ;(window as unknown as { api: Record<string, unknown> }).api.search = vi.fn(async () => [
      { provider: 'discogs', id: 1, title: 'First Release' },
      { provider: 'discogs', id: 2, title: 'Second Release' },
    ])
    renderEditor({ id: 'a', query: 'artist song' })
    const results = await screen.findAllByTestId('discogs-result')

    results[0].focus()
    fireEvent.keyDown(results[0], { key: 'j' })
    expect(results[1]).toHaveFocus()
    fireEvent.keyDown(results[1], { key: 'k' })
    expect(results[0]).toHaveFocus()
  })

  // The probe can find the file's track in a result that is not the first. Rather than
  // reorder the list under the user (it would jump when the async probe lands), the matched
  // row is badged "Suggested" in place — here the track lives only in the second release, so
  // the badge must sit on the second row, not the first.
  it('badges the probe-matched result as suggested without reordering the list', async () => {
    const api = (window as unknown as { api: Record<string, unknown> }).api
    api.search = vi.fn(async () => [
      { provider: 'discogs', id: 1, title: 'First Release' },
      { provider: 'discogs', id: 2, title: 'Second Release' },
    ])
    // fetchRelease passes the release id (not the result object) to the bridge.
    api.getRelease = vi.fn(async (id: number) =>
      id === 2
        ? { id: 2, title: 'Second Release', tracklist: [{ position: 'A1', title: 'My Song' }] }
        : { id: 1, title: 'First Release', tracklist: [{ position: 'A1', title: 'Other' }] },
    )
    renderEditor({ id: 'a', query: 'artist song', meta: { title: 'My Song' } })
    const results = await screen.findAllByTestId('discogs-result')
    const badge = await screen.findByTestId('result-suggested')
    expect(results[1]).toContainElement(badge)
    expect(results[0]).not.toContainElement(badge)
  })

  // The candidate header speaks the track list's language: the "Suggested" signal is the
  // same sparkle mark the track list uses for a match (not an on-header text pill), so the
  // wording lives in its tooltip and a check-looking tick never implies "already applied".
  it('marks a suggested candidate with a sparkle whose label is in the tooltip', async () => {
    const api = (window as unknown as { api: Record<string, unknown> }).api
    api.search = vi.fn(async () => [{ provider: 'bandcamp', id: 1, title: 'The Release' }])
    api.getRelease = vi.fn(async () => ({
      id: 1,
      title: 'The Release',
      tracklist: [{ position: 'A1', title: 'My Song' }],
    }))
    renderEditor({ id: 'a', query: 'artist song', meta: { title: 'My Song' } })
    const badge = await screen.findByTestId('result-suggested')
    expect(badge).toHaveTextContent('')
    for (const type of ['pointerenter', 'pointermove']) {
      badge.dispatchEvent(new MouseEvent(type, { clientX: 10, clientY: 10, bubbles: true }))
    }
    expect(await screen.findByRole('tooltip')).toHaveTextContent(i18n.t('editor.matchSuggested'))
  })

  // The provider is an origin label, not a match signal — so it wears the same
  // bordered, unfilled pill the track list gives the WAV/FLAC format tag, not a
  // filled chip that would compete with the sparkle for attention.
  it('shows the provider as a bordered pill like the track list format tag', async () => {
    const api = (window as unknown as { api: Record<string, unknown> }).api
    api.search = vi.fn(async () => [{ provider: 'bandcamp', id: 1, title: 'The Release' }])
    renderEditor({ id: 'a', query: 'artist song' })
    const provider = await screen.findByTestId('result-provider')
    expect(provider.className).toContain('border')
    expect(provider.className).not.toMatch(/bg-\[var\(--color-panel-2\)\]/)
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
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ bpm: '124' }) }),
    )
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
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ key: '8A' }) }),
    )
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
    renderWithQuery(<MultiHarness />, { visibleFields: ['title', 'album', 'year', 'genre'] })
    // Fields commit on blur (the buffer only reaches global state when the user leaves
    // the field), so each edit is followed by the blur that moving to the next field fires.
    const year = screen.getByTestId('field-year')
    fireEvent.change(year, { target: { value: '1999' } })
    fireEvent.blur(year)
    const genre = screen.getByTestId('field-genre')
    fireEvent.change(genre, { target: { value: 'House' } })
    fireEvent.blur(genre)
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
        libraryIndex={null}
        searchInputRef={createRef<HTMLInputElement>()}
        onExportCollection={vi.fn()}
        onResultsWidthChange={vi.fn()}
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
        onTrimDetectedAll={vi.fn()}
        onCopyFilename={vi.fn()}
        onSearchWeb={vi.fn()}
      />,
      {
        addToAppleMusic: opts.music ?? false,
        visibleFields: opts.visibleFields ?? ['title', 'album'],
        showSpectrum: true,
        showLoudness: opts.loudness ?? false,
      },
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
    // The field buffers and commits on blur, so leaving the field is what pushes the edit up.
    const album = screen.getByTestId('field-album')
    fireEvent.change(album, { target: { value: 'New Album' } })
    fireEvent.blur(album)
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

  // The quiet re-export button must keep working over a selection: its body
  // re-runs the whole batch in the chosen format.
  it('re-exports the whole selection from the quiet button', () => {
    const { onProcessAll } = renderMulti({ done: true })
    fireEvent.click(screen.getByTestId('process-btn'))
    expect(onProcessAll).toHaveBeenCalledWith('aiff')
  })
})

describe('Editor export control', () => {
  // The original bug: once a track was done its export button vanished, so a user
  // who exported WAV had no way to also export MP3 without reloading the file. The
  // quiet split-button keeps that path open: the chevron re-picks the format and
  // the body exports, without reloading the file or touching Settings.
  it('keeps the re-export split-button working after the track is done', () => {
    const { onProcess, onFormatChange } = renderEditor({
      id: 'a',
      status: 'done',
      outputPath: '/out/a.wav',
    })
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.click(screen.getByTestId('process-format-mp3'))
    expect(onFormatChange).toHaveBeenCalledWith('mp3')
    fireEvent.click(screen.getByTestId('process-btn'))
    expect(onProcess).toHaveBeenCalled()
  })

  // Once done, the outcome line confirms what was written and "Show file" rides
  // it as an inline link — a quick check on the file, not a next step, so it
  // must not outshout the destination buttons below.
  it('confirms the export outcome and reveals the file from its inline link', () => {
    renderEditor({ id: 'a', status: 'done', inputPath: '/music/a.flac', outputPath: '/out/a.wav' })
    expect(screen.getByTestId('export-success')).toHaveTextContent('WAV')
    fireEvent.click(screen.getByTestId('show-file'))
    expect(
      (window as unknown as { api: { reveal: ReturnType<typeof vi.fn> } }).api.reveal,
    ).toHaveBeenCalledWith('/out/a.wav')
  })

  // The toolbar export button moved here: sending the collection to another DJ app
  // is a post-conversion step, so it rides the done-state footer — and never shows
  // before a conversion has landed.
  it('offers the DJ-app collection export once the track is done', () => {
    const { onExportCollection } = renderEditor({
      id: 'a',
      status: 'done',
      outputPath: '/out/a.wav',
    })
    fireEvent.click(screen.getByTestId('export-collection'))
    expect(onExportCollection).toHaveBeenCalled()
  })

  it('hides the DJ-app export before the track converts', () => {
    renderEditor({ id: 'a' })
    expect(screen.queryByTestId('export-collection')).not.toBeInTheDocument()
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

  // Djotas's re-normalize flow: after exporting at one loudness, dialing another
  // value must bring the Update button back on its own — without this, re-applying
  // a new target meant faking a tag edit (or reloading the file) to convert again.
  it('returns to the convert button when the normalization dial changes after export', () => {
    const applied = { mode: 'loudness' as const, targetLufs: -14, truePeakDb: -1, peakDb: -1 }
    renderEditor(
      { id: 'a', status: 'done', outputPath: '/out/a.aiff', processedNormalize: applied },
      'aiff',
      {
        normalize: applied,
        // The section ships folded now, so the settings open it to reach the dials.
        editorSections: [{ id: 'normalize' as const, open: true }],
      },
    )
    expect(screen.getByTestId('export-success')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('normalize-preset-club'))
    expect(screen.queryByTestId('export-success')).not.toBeInTheDocument()
    expect(screen.getByTestId('process-btn')).toBeInTheDocument()
  })

  // The section order below the metadata form is the user's (Settings → Editor): a DJ
  // who tunes loudness before naming the file puts Normalization above File name, and
  // the editor must honor that instead of hardcoding one editorial order.
  it('renders the sections in the settings-configured order', () => {
    renderEditor({ id: 'a' }, 'wav', {
      showLoudness: true,
      editorSections: [
        { id: 'form', open: true },
        { id: 'normalize', open: false },
        { id: 'quality', open: false },
        { id: 'properties', open: false },
        { id: 'output', open: false },
      ],
    })
    const rendered = [
      screen.getByTestId('editor-normalize'),
      screen.getByText('Audio quality'),
      screen.getByText('Properties'),
      screen.getByText('File name'),
    ]
    for (let i = 0; i < rendered.length - 1; i++) {
      expect(
        rendered[i].compareDocumentPosition(rendered[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }
  })

  // A hidden section is removed from the editor entirely, not just folded — the
  // Settings eye toggle is how a DJ drops sections they never use (e.g. Properties).
  it('skips sections hidden in the settings', () => {
    renderEditor({ id: 'a' }, 'wav', {
      editorSections: [
        { id: 'form', open: true },
        { id: 'properties', open: false, hidden: true },
        { id: 'quality', open: false },
        { id: 'normalize', open: false },
        { id: 'output', open: false },
      ],
    })
    expect(screen.queryByText('Properties')).not.toBeInTheDocument()
    expect(screen.getByTestId('editor-normalize')).toBeInTheDocument()
  })

  // With the form folded, the header states whose tags these are — artist and
  // title — so a fully folded editor still reads as a track, not a stack of
  // anonymous headers.
  it('summarizes artist and title in the metadata header while folded', () => {
    renderEditor({ id: 'a', meta: { artist: 'Critical Mass', title: 'In Your Eyes' } }, 'wav', {
      editorSections: [
        { id: 'form', open: false },
        { id: 'properties', open: false },
        { id: 'quality', open: false },
        { id: 'normalize', open: false },
        { id: 'output', open: false },
      ],
    })
    expect(screen.getByTestId('form-summary')).toHaveTextContent('Critical Mass — In Your Eyes')
    expect(screen.queryByTestId('field-title')).not.toBeInTheDocument()
  })

  // The header's icon actions (copy name, search web, clear, derive) all act on the
  // fields below — folded, there is nothing on screen they refer to, so they fold
  // with the section instead of floating next to the summary.
  it('hides the metadata header actions while the form is folded', () => {
    renderEditor({ id: 'a', meta: { artist: 'A', title: 'T' } }, 'wav', {
      editorSections: [
        { id: 'form', open: false },
        { id: 'properties', open: false },
        { id: 'quality', open: false },
        { id: 'normalize', open: false },
        { id: 'output', open: false },
      ],
    })
    expect(screen.queryByTestId('clear-meta-btn')).not.toBeInTheDocument()
    expect(screen.queryByTestId('derive-btn')).not.toBeInTheDocument()
    expect(screen.queryByTestId('copy-filename-btn')).not.toBeInTheDocument()
    expect(screen.queryByTestId('search-web-btn')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Metadata' }))
    expect(screen.getByTestId('clear-meta-btn')).toBeInTheDocument()
    expect(screen.getByTestId('copy-filename-btn')).toBeInTheDocument()
  })

  it('muestra las etiquetas de los grupos de acciones en el header', () => {
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav')
    expect(screen.getByTestId('actions-file-label')).toBeInTheDocument()
    expect(screen.getByTestId('actions-tags-label')).toBeInTheDocument()
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

describe('Editor replace old Apple Music copy', () => {
  // The user's manual loop today: convert the fresh rip, add it to Apple Music, then
  // hunt down and delete the old lower-quality copy in Music by hand. When the library
  // snapshot shows a matching entry under a DIFFERENT persistent ID than the one the
  // add returned, that entry is the superseded copy — offer removing it right here.
  it('offers to remove the superseded library copy after the add', () => {
    ;(window as unknown as { api: { platform: string } }).api.platform = 'darwin'
    const libraryIndex = buildLibraryIndex([
      {
        title: 'Save My Love (26 Rmx)',
        artist: 'Djmofly',
        durationSec: 365,
        persistentId: 'OLDCOPY123456789',
      },
    ])
    const { onRemoveOldMusicCopy } = renderEditor(
      {
        id: 'a',
        status: 'done',
        outputPath: '/out/a.aiff',
        musicStatus: 'added',
        musicPersistentId: 'NEWCOPY123456789',
        duration: 365,
        meta: { title: 'Save My Love (Original Mix)', artist: 'DJ Mofly' },
      },
      'aiff',
      { libraryIndex },
    )
    fireEvent.click(screen.getByTestId('remove-old-copy'))
    expect(onRemoveOldMusicCopy).toHaveBeenCalledWith({
      persistentId: 'OLDCOPY123456789',
      label: 'Djmofly - Save My Love (26 Rmx)',
    })
  })

  // Once the snapshot refreshes it also holds the copy the add itself created; the
  // offer must never point at that fresh copy — "replacing" it would delete the track
  // the user just added.
  it('never offers to remove the copy the add itself created', () => {
    ;(window as unknown as { api: { platform: string } }).api.platform = 'darwin'
    const libraryIndex = buildLibraryIndex([
      {
        title: 'Save My Love (Original Mix)',
        artist: 'DJ Mofly',
        durationSec: 365,
        persistentId: 'NEWCOPY123456789',
      },
    ])
    renderEditor(
      {
        id: 'a',
        status: 'done',
        outputPath: '/out/a.aiff',
        musicStatus: 'added',
        musicPersistentId: 'NEWCOPY123456789',
        duration: 365,
        meta: { title: 'Save My Love (Original Mix)', artist: 'DJ Mofly' },
      },
      'aiff',
      { libraryIndex },
    )
    expect(screen.queryByTestId('remove-old-copy')).not.toBeInTheDocument()
  })

  // Before the add there is nothing in the library to supersede anything: the entry the
  // matcher sees IS the user's only copy, and deleting it would not be a replace.
  it('does not offer the removal before the track was added to Apple Music', () => {
    ;(window as unknown as { api: { platform: string } }).api.platform = 'darwin'
    const libraryIndex = buildLibraryIndex([
      {
        title: 'Save My Love (26 Rmx)',
        artist: 'Djmofly',
        durationSec: 365,
        persistentId: 'OLDCOPY123456789',
      },
    ])
    renderEditor(
      {
        id: 'a',
        status: 'done',
        outputPath: '/out/a.aiff',
        duration: 365,
        meta: { title: 'Save My Love (Original Mix)', artist: 'DJ Mofly' },
      },
      'aiff',
      { libraryIndex },
    )
    expect(screen.queryByTestId('remove-old-copy')).not.toBeInTheDocument()
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

  // ALAC never edits in place — an .m4a source may be lossy AAC, so the export always
  // renders a fresh file and keeps the source (see shared/format). In overwrite mode
  // the generic "replaces the source" promise would be a lie for ALAC; the notice must
  // say the original is kept instead.
  it('says the original is kept when overwrite mode targets ALAC', () => {
    renderEditor({ id: 'a', inputPath: '/music/a.m4a' }, 'alac', { overwriteOriginal: true })
    expect(screen.getByTestId('overwrite-hint')).toHaveTextContent(
      i18n.t('editor.overwriteAlacHint'),
    )
  })
})

describe('Editor star rating', () => {
  it('sets the rating to the clicked star', () => {
    const { onChange } = renderEditor({ id: 'a' })
    fireEvent.click(screen.getByTestId('star-4'))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ rating: '4' }) }),
    )
  })

  // Clicking the highest filled star again clears the rating, so a misclick is undoable.
  it('clears the rating when the active star is clicked again', () => {
    const { onChange } = renderEditor({ id: 'a', meta: { rating: '3' } })
    fireEvent.click(screen.getByTestId('star-3'))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ rating: '' }) }),
    )
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
      recordStat: vi.fn(),
      clicks: vi.fn().mockResolvedValue(null),
      // The repair section subscribes to render progress on mount, so the bridge
      // must hand back an unsubscribe even in tests that never open it.
      onDeclickPreviewProgress: vi.fn().mockReturnValue(() => {}),
      cancelDeclickPreview: vi.fn().mockResolvedValue(undefined),
      platform: 'win32',
      reveal: vi.fn(),
      properties: vi.fn().mockResolvedValue(null),
      hasClipboardImage: vi.fn().mockResolvedValue(false),
      onWindowFocus: vi.fn(() => () => {}),
      search: vi.fn().mockResolvedValue([searchResult]),
      getRelease,
    }
    return { getRelease }
  }

  async function search(): Promise<void> {
    fireEvent.change(screen.getByTestId('discogs-query'), { target: { value: 'some album' } })
    fireEvent.keyDown(screen.getByTestId('discogs-query'), { key: 'Enter' })
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

  // Applying a release is the cue to verify the tags, so focus jumps to the first field —
  // the keyboard flow continues ⌘2 → pick → Enter → edit without a manual ⌘3.
  it('moves focus to the first field after a track is applied', async () => {
    withDiscogs()
    renderEditor({ id: 'a' }, 'wav', { visibleFields: ['title'] })
    await search()
    fireEvent.click(screen.getByTestId('discogs-result'))
    fireEvent.click((await screen.findAllByTestId('discogs-track'))[0])
    expect(screen.getByTestId('field-title')).toHaveFocus()
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

  // The fix for the badge/filter disagreement: a file whose own tags the Apple Music
  // library can't recognise ('Bootleg Rip') but whose confidently-matched release resolves
  // to the canonical artist the library knows ('The Artist') must persist the owned verdict
  // (inLibraryResolved) — not just flip the badge — so the list and its filter agree with
  // the badge instead of still counting the track as not owned.
  it('persists the owned verdict when a confident release proves the track is in the library', async () => {
    const { getRelease } = withDiscogs()
    ;(window as unknown as { api: { platform: string } }).api.platform = 'darwin'
    // The library knows the canonical 'Track One' / 'The Artist'; the raw tags don't match it.
    const libraryIndex = buildLibraryIndex([{ title: 'Track One', artist: 'The Artist' }])
    const { onChange } = renderEditor(
      { id: 'a', meta: { title: 'Track One', artist: 'Bootleg Rip' } },
      'wav',
      { libraryIndex },
    )
    await search()
    // The matching release auto-opens, so the editor's second library check (on the canonical
    // suggestion) runs without the user picking anything; that resolves owned and persists it.
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ inLibraryResolved: true }))
    expect(getRelease).toHaveBeenCalled()
  })

  // The mirror: when the confident match isn't in the library either, the editor must not
  // pin anything — the list already recomputes that not-owned verdict from the raw tags.
  it('does not persist an owned verdict when the match is not in the library', async () => {
    withDiscogs()
    ;(window as unknown as { api: { platform: string } }).api.platform = 'darwin'
    const libraryIndex = buildLibraryIndex([{ title: 'Other Song', artist: 'Someone' }])
    const { onChange } = renderEditor(
      { id: 'a', meta: { title: 'Track One', artist: 'Bootleg Rip' } },
      'wav',
      { libraryIndex },
    )
    await search()
    await screen.findAllByTestId('discogs-track')
    expect(onChange).not.toHaveBeenCalledWith({ inLibraryResolved: true })
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
      recordStat: vi.fn(),
      clicks: vi.fn().mockResolvedValue(null),
      // The repair section subscribes to render progress on mount, so the bridge
      // must hand back an unsubscribe even in tests that never open it.
      onDeclickPreviewProgress: vi.fn().mockReturnValue(() => {}),
      cancelDeclickPreview: vi.fn().mockResolvedValue(undefined),
      platform: 'win32',
      reveal: vi.fn(),
      properties: vi.fn().mockResolvedValue(null),
      hasClipboardImage: vi.fn().mockResolvedValue(false),
      onWindowFocus: vi.fn(() => () => {}),
      prepareCoverDrag: () => Promise.resolve(null),
      search: vi.fn().mockResolvedValue([searchResult]),
      getRelease: vi.fn().mockResolvedValue(withImage),
    }
  }

  // The user's complaint these guard against: applying a release to fix text tags
  // must not throw away a good embedded cover. With a cover already present, picking
  // a track keeps it and ignores the release's image.
  it('keeps an existing cover when applying a release', async () => {
    withImages()
    const { onChange } = renderEditor({
      id: 'a',
      coverUrl: 'embedded.jpg',
      embeddedCover: 'embedded.jpg',
    })
    await search()
    fireEvent.click(screen.getByTestId('discogs-result'))
    fireEvent.click((await screen.findAllByTestId('discogs-track'))[0])
    expect(onChange.mock.calls.at(-1)?.[0].coverUrl).toBe('embedded.jpg')
  })

  // By default the user's own cover wins even when it's low-res: a small but correct
  // art (e.g. the actual single's sleeve) must not be silently swapped for the
  // release's larger-but-generic image (e.g. a compilation cover). Low-res is only
  // flagged, never auto-replaced, unless the user opts in (see next test).
  it('keeps a low-res cover by default when applying a release', async () => {
    withImages()
    const { onChange } = renderEditor({ id: 'a', coverUrl: 'tiny.jpg', embeddedCover: 'tiny.jpg' })
    const img = screen.getByTestId('cover-preview')
    Object.defineProperty(img, 'naturalWidth', { value: 200, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: 200, configurable: true })
    fireEvent.load(img)
    await search()
    fireEvent.click(screen.getByTestId('discogs-result'))
    fireEvent.click((await screen.findAllByTestId('discogs-track'))[0])
    expect(onChange.mock.calls.at(-1)?.[0].coverUrl).toBe('tiny.jpg')
  })

  // With the Artwork setting opted in, a low-res existing cover is replaced by the
  // release image so the track ends up with sharper art.
  it('replaces a low-res cover with the release image when the setting is on', async () => {
    withImages()
    const { onChange } = renderEditor(
      { id: 'a', coverUrl: 'tiny.jpg', embeddedCover: 'tiny.jpg' },
      'wav',
      {
        replaceLowResCover: true,
      },
    )
    const img = screen.getByTestId('cover-preview')
    Object.defineProperty(img, 'naturalWidth', { value: 200, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: 200, configurable: true })
    fireEvent.load(img)
    await search()
    fireEvent.click(screen.getByTestId('discogs-result'))
    fireEvent.click((await screen.findAllByTestId('discogs-track'))[0])
    expect(onChange.mock.calls.at(-1)?.[0].coverUrl).toBe('discogs.jpg')
  })

  // The user's nuance: once a release image has replaced the original (coverUrl no longer
  // equals embeddedCover), there's none of the user's own art left to protect — so picking
  // ANOTHER release swaps the cover again, even with the replace-low-res setting off. The
  // flag guards only the file's ORIGINAL embedded cover, not a prior release image.
  it('replaces an already-applied release cover on the next pick, setting off', async () => {
    withImages()
    const { onChange } = renderEditor({
      id: 'a',
      coverUrl: 'prev-release.jpg',
      embeddedCover: 'embedded.jpg',
    })
    await search()
    fireEvent.click(screen.getByTestId('discogs-result'))
    fireEvent.click((await screen.findAllByTestId('discogs-track'))[0])
    expect(onChange.mock.calls.at(-1)?.[0].coverUrl).toBe('discogs.jpg')
  })

  // A file that never had embedded art has nothing original to protect, so applying a
  // release fills the cover from the release image (coverUrl !== embeddedCover because
  // embeddedCover is undefined).
  it('fills the cover from the release when the file had no embedded art', async () => {
    withImages()
    const { onChange } = renderEditor({ id: 'a', coverUrl: 'prev-release.jpg' })
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
      recordStat: vi.fn(),
      clicks: vi.fn().mockResolvedValue(null),
      // The repair section subscribes to render progress on mount, so the bridge
      // must hand back an unsubscribe even in tests that never open it.
      onDeclickPreviewProgress: vi.fn().mockReturnValue(() => {}),
      cancelDeclickPreview: vi.fn().mockResolvedValue(undefined),
      platform: 'win32',
      reveal: vi.fn(),
      properties: vi.fn().mockResolvedValue(null),
      hasClipboardImage: vi.fn().mockResolvedValue(false),
      onWindowFocus: vi.fn(() => () => {}),
      prepareCoverDrag: () => Promise.resolve(null),
      search: vi.fn().mockResolvedValue([searchResult]),
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
      recordStat: vi.fn(),
      clicks: vi.fn().mockResolvedValue(null),
      // The repair section subscribes to render progress on mount, so the bridge
      // must hand back an unsubscribe even in tests that never open it.
      onDeclickPreviewProgress: vi.fn().mockReturnValue(() => {}),
      cancelDeclickPreview: vi.fn().mockResolvedValue(undefined),
      platform: 'win32',
      reveal: vi.fn(),
      properties: vi.fn().mockResolvedValue(null),
      hasClipboardImage: vi.fn().mockResolvedValue(false),
      onWindowFocus: vi.fn(() => () => {}),
      search: vi.fn().mockResolvedValue([searchResult]),
      getRelease: vi.fn().mockResolvedValue(release),
    }
  }

  async function loadTracklist(): Promise<HTMLElement[]> {
    fireEvent.change(screen.getByTestId('discogs-query'), { target: { value: 'some album' } })
    fireEvent.keyDown(screen.getByTestId('discogs-query'), { key: 'Enter' })
    // A confident match auto-opens its tracklist; a low-confidence one doesn't, so open it
    // by hand only when it isn't already expanded — clicking an open row would collapse it.
    const result = await screen.findByTestId('discogs-result')
    if (result.getAttribute('aria-expanded') !== 'true') fireEvent.click(result)
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

  // A confident preselection (exact title, artist agreeing) and a shakier one (a partial
  // match) should not look the same: the badge tells the user whether to trust the
  // highlight or double-check it, which is what makes a batch auto-match safe.
  it('marks an exact-title preselection with an agreeing artist as a confident match', async () => {
    withDiscogs()
    renderEditor({ id: 'a', meta: { title: 'track two remix', artist: 'The Artist' } })
    await loadTracklist()
    expect(await screen.findByTestId('track-confidence')).toHaveAttribute('data-confidence', 'high')
  })

  // An exact title with nothing to corroborate it (no durations, no agreeing artist, no
  // catalog number) is the classic false positive — a same-named track on another act's
  // release — so the badge shows the same 'review' verdict the sweep acts on.
  it('marks an exact-title preselection with no corroborating signal for review', async () => {
    withDiscogs()
    renderEditor({ id: 'a', meta: { title: 'track two remix' } })
    await loadTracklist()
    expect(await screen.findByTestId('track-confidence')).toHaveAttribute(
      'data-confidence',
      'review',
    )
  })

  // A check icon reads as "already applied", but nothing is applied until the user
  // clicks the row — so the suggestion is a sparkle (the same mark the track list uses
  // for a match), not a tick, with the "Suggested" wording moved into its tooltip. A
  // tick here would make the user assume the metadata is already filled in. The mark
  // carries no on-row text, so the row stays a clean number/title/duration line.
  it('marks the preselection with a sparkle and no on-row label', async () => {
    withDiscogs()
    renderEditor({ id: 'a', meta: { title: 'track two remix' } })
    await loadTracklist()
    const badge = await screen.findByTestId('track-confidence')
    expect(badge).toHaveTextContent('')
    for (const type of ['pointerenter', 'pointermove']) {
      badge.dispatchEvent(new MouseEvent(type, { clientX: 10, clientY: 10, bubbles: true }))
    }
    expect(await screen.findByRole('tooltip')).toHaveTextContent(i18n.t('editor.matchSuggested'))
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

  // Clicking a row applies its metadata, and the row must read as picked afterwards.
  // The suggestion highlight alone can't carry that: a rip whose real length misses
  // Discogs' printed duration by more than even the proportional window (here half a
  // minute — an edited-down rip) zeroes the duration signal and drops the score below
  // the review tier — so the user's own deliberate pick showed no mark at all.
  // The applied row is derived from the tags the file now carries, not from the score.
  it('keeps the applied row marked when the fuzzy match is too weak to suggest it', async () => {
    withDiscogs()
    ;(window as unknown as { api: { getRelease: unknown } }).api.getRelease = vi
      .fn()
      .mockResolvedValue({
        ...release,
        tracklist: [
          { position: 'A1', title: 'Track One', duration: '7:02' },
          { position: 'A2', title: 'Track Two (Remix)', duration: '6:40' },
        ],
      })
    renderEditor({ id: 'a', duration: 390, meta: { title: 'Track One', trackNumber: 'A1' } })
    const rows = await loadTracklist()
    const applied = rows.find((r) => r.textContent?.includes('Track One'))
    const other = rows.find((r) => r.textContent?.includes('Track Two (Remix)'))
    // The weak score suppresses the suggestion badge, but the applied mark stays.
    expect(screen.queryByTestId('track-confidence')).toBeNull()
    expect(applied).toHaveAttribute('aria-current', 'true')
    expect(other).not.toHaveAttribute('aria-current')
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

  // The header carries a one-line digest of the facts that matter most at a glance
  // (container · kHz · bit · mode · size) so the folded panel is still useful — the
  // user reads the rip's shape without opening it, and the full readout stays out of
  // the way until they want it.
  it('shows a one-line summary in the header while folded', async () => {
    seedProperties(properties)
    renderEditor({ id: 'a' })
    const summary = await screen.findByTestId('properties-summary')
    await waitFor(() => expect(summary).toHaveTextContent('WAV'))
    expect(summary).toHaveTextContent('44.1 kHz')
    expect(summary).toHaveTextContent('16 Bit')
    expect(summary).toHaveTextContent('Stereo')
    expect(summary).toHaveTextContent('55.7 MB')
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

describe('Editor album "without version" suggestion', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  function openAlbumMenu(): void {
    const trigger = screen.getByTestId('field-insert-album')
    fireEvent.mouseDown(trigger)
    fireEvent.click(trigger)
  }

  // The common single-release case: the album tag is empty, so the clean album is
  // derived from the title with its mix parenthetical stripped.
  it('derives the clean album from the title when the album is empty', () => {
    renderEditor({ id: 'a', meta: { title: 'My Weapon (Original Mix)', album: '' } }, 'wav', {
      visibleFields: ['title', 'album'],
    })
    openAlbumMenu()
    expect(screen.getByTestId('field-insert-option-clean')).toHaveTextContent('My Weapon')
  })

  // When the album already has a value, that — not the title — is what gets cleaned.
  it('cleans the album value itself when the album is filled', () => {
    renderEditor(
      { id: 'a', meta: { title: 'Other (mix)', album: 'Nordic Dome (Original mix)' } },
      'wav',
      { visibleFields: ['title', 'album'] },
    )
    openAlbumMenu()
    expect(screen.getByTestId('field-insert-option-clean')).toHaveTextContent('Nordic Dome')
  })

  // Nothing to strip → no row, so the menu never offers a no-op clean-up.
  it('offers no clean row when neither album nor title carries a parenthetical', () => {
    renderEditor({ id: 'a', meta: { title: 'My Weapon', album: '' } }, 'wav', {
      visibleFields: ['title', 'album'],
    })
    openAlbumMenu()
    expect(screen.queryByTestId('field-insert-option-clean')).toBeNull()
  })
})

describe('Editor Apple Music library badge', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  function setApi(platform: string): void {
    ;(window as unknown as { api: unknown }).api = {
      recordStat: vi.fn(),
      clicks: vi.fn().mockResolvedValue(null),
      // The repair section subscribes to render progress on mount, so the bridge
      // must hand back an unsubscribe even in tests that never open it.
      onDeclickPreviewProgress: vi.fn().mockReturnValue(() => {}),
      cancelDeclickPreview: vi.fn().mockResolvedValue(undefined),
      platform,
      reveal: vi.fn(),
      properties: vi.fn().mockResolvedValue(null),
      hasClipboardImage: vi.fn().mockResolvedValue(false),
      onWindowFocus: vi.fn(() => () => {}),
    }
  }

  const owned: AppleMusicIndex = buildLibraryIndex([{ title: 'Strobe', artist: 'deadmau5' }])

  // The badge exists so a DJ doesn't re-import a song they already own; on macOS it
  // checks the live title/artist against the same library snapshot the list and filter
  // read, so the badge can never disagree with the row's in-library state.
  it('flags a track already in the Apple Music library on macOS', () => {
    setApi('darwin')
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav', {
      libraryIndex: owned,
    })
    expect(screen.getByTestId('apple-music-status')).toHaveTextContent(
      'In library',
    )
  })

  // With Engine DJ as the destination the same badge reads the Engine library — and
  // names it, so the user never wonders which library "already in" refers to. Not
  // macOS-gated: the Engine database is plain SQLite on every platform.
  it('names Engine DJ when it is the destination library', () => {
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav', {
      addToAppleMusic: false,
      addToEngineDj: true,
      libraryIndex: owned,
    })
    expect(screen.getByTestId('apple-music-status')).toHaveTextContent(
      'In library',
    )
  })

  // The complement: a song not found in the snapshot reassures the user it's safe to add.
  it('flags a track that is not in the library', () => {
    setApi('darwin')
    renderEditor({ id: 'a', meta: { title: 'Unknown', artist: 'Nobody' } }, 'wav', {
      libraryIndex: owned,
    })
    expect(screen.getByTestId('apple-music-status')).toHaveTextContent(
      'Not in library',
    )
  })

  // A track Surco itself added carries its library copy's persistent ID, so it reads as
  // owned even before the snapshot lands — mirroring the list's verdict for the same row.
  it('flags a Surco-added track as owned before the snapshot has loaded', () => {
    setApi('darwin')
    renderEditor(
      { id: 'a', musicPersistentId: 'ABCD1234', meta: { title: 'Fresh', artist: 'New' } },
      'wav',
      { libraryIndex: null },
    )
    expect(screen.getByTestId('apple-music-status')).toHaveTextContent(
      'In library',
    )
  })

  // Until the snapshot arrives there is no verdict to show, so the badge stays hidden
  // rather than guessing — the slot fills once the library has loaded.
  it('hides the badge until the snapshot has loaded', () => {
    setApi('darwin')
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav', {
      libraryIndex: null,
    })
    expect(screen.queryByTestId('apple-music-status')).toBeNull()
  })

  // Rendering the badge before the "Fill from filename" button keeps that button
  // anchored at the header's edge when the badge mounts.
  it('renders the badge before the fill-from-filename button', () => {
    setApi('darwin')
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav', {
      libraryIndex: owned,
    })
    const badge = screen.getByTestId('apple-music-status')
    const derive = screen.getByTestId('derive-btn')
    expect(badge.compareDocumentPosition(derive) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // Off macOS there is no Apple Music library, so the badge stays hidden rather than
  // making a promise the platform can't keep.
  it('never shows the badge off macOS', () => {
    setApi('win32')
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav', {
      libraryIndex: owned,
    })
    expect(screen.queryByTestId('apple-music-status')).toBeNull()
  })
})

describe('Editor Apple Music badge via the Discogs suggestion', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  // A track number/title tag the file ships with is often messier than the canonical
  // spelling the user searched for — and the library is keyed by the canonical name. So a
  // confident suggested release bridges a tag the library can't recognise on its own.
  const release = {
    id: 7,
    title: 'Some Album',
    artists: [{ name: 'The Artist' }],
    tracklist: [{ position: 'A1', title: 'Track Two (Remix)' }],
  }

  function setApi(): void {
    ;(window as unknown as { api: unknown }).api = {
      recordStat: vi.fn(),
      clicks: vi.fn().mockResolvedValue(null),
      // The repair section subscribes to render progress on mount, so the bridge
      // must hand back an unsubscribe even in tests that never open it.
      onDeclickPreviewProgress: vi.fn().mockReturnValue(() => {}),
      cancelDeclickPreview: vi.fn().mockResolvedValue(undefined),
      platform: 'darwin',
      reveal: vi.fn(),
      properties: vi.fn().mockResolvedValue(null),
      hasClipboardImage: vi.fn().mockResolvedValue(false),
      onWindowFocus: vi.fn(() => () => {}),
      search: vi.fn().mockResolvedValue([{ id: 7, title: 'Some Album', cover_image: 'c.jpg' }]),
      getRelease: vi.fn().mockResolvedValue(release),
    }
  }

  it('flags the track as owned once a confident suggestion matches the library', async () => {
    setApi()
    const owned = buildLibraryIndex([{ title: 'Track Two (Remix)', artist: 'The Artist' }])
    renderEditor(
      { id: 'a', meta: { title: 'track two remix', artist: 'Wrong Tag Artist' } },
      'wav',
      {
        libraryIndex: owned,
      },
    )
    // The file's own artist tag isn't in the library, so the badge starts negative.
    expect(screen.getByTestId('apple-music-status')).toHaveTextContent(
      'Not in library',
    )
    fireEvent.change(screen.getByTestId('discogs-query'), { target: { value: 'some album' } })
    fireEvent.keyDown(screen.getByTestId('discogs-query'), { key: 'Enter' })
    const result = await screen.findByTestId('discogs-result')
    if (result.getAttribute('aria-expanded') !== 'true') fireEvent.click(result)
    await screen.findAllByTestId('discogs-track')
    // The release's canonical "The Artist — Track Two (Remix)" is owned, so the badge flips
    // even though the file tag never matched on its own.
    expect(await screen.findByTestId('apple-music-status')).toHaveTextContent(
      'In library',
    )
  })

  // The suggestion must not manufacture a false positive: an owned-looking release whose
  // canonical name still isn't in the library leaves the badge negative.
  it('keeps the badge negative when the suggestion is not in the library either', async () => {
    setApi()
    const owned = buildLibraryIndex([{ title: 'Something Else', artist: 'Nobody' }])
    renderEditor(
      { id: 'a', meta: { title: 'track two remix', artist: 'Wrong Tag Artist' } },
      'wav',
      {
        libraryIndex: owned,
      },
    )
    fireEvent.change(screen.getByTestId('discogs-query'), { target: { value: 'some album' } })
    fireEvent.keyDown(screen.getByTestId('discogs-query'), { key: 'Enter' })
    const result = await screen.findByTestId('discogs-result')
    if (result.getAttribute('aria-expanded') !== 'true') fireEvent.click(result)
    await screen.findAllByTestId('discogs-track')
    expect(screen.getByTestId('apple-music-status')).toHaveTextContent(
      'Not in library',
    )
  })

  // The bug this guards: while Discogs is still searching, its match could yet prove the
  // track owned, so the badge must NOT flash "not in library" only to correct itself a
  // second later. It shows "Checking…" until the search settles.
  it('shows a checking state while Discogs is still searching, not a premature negative', async () => {
    setApi()
    // Hold the search open so the editor stays in its in-flight window for the assertion.
    let release_: () => void = () => {}
    const gate = new Promise<unknown[]>((res) => {
      release_ = () => res([{ id: 7, title: 'Some Album', cover_image: 'c.jpg' }])
    })
    ;(window as unknown as { api: { search: unknown } }).api.search = vi.fn(() => gate)
    const owned = buildLibraryIndex([{ title: 'Track Two (Remix)', artist: 'The Artist' }])
    renderEditor(
      { id: 'a', meta: { title: 'track two remix', artist: 'Wrong Tag Artist' } },
      'wav',
      {
        libraryIndex: owned,
      },
    )
    fireEvent.change(screen.getByTestId('discogs-query'), { target: { value: 'some album' } })
    fireEvent.keyDown(screen.getByTestId('discogs-query'), { key: 'Enter' })
    // The search is in flight: the raw tags don't match, but the verdict isn't "no" yet.
    await waitFor(() =>
      expect(screen.getByTestId('apple-music-status')).toHaveTextContent('Checking…'),
    )
    release_()
  })

  // The exact flicker the user reported: a track opens with a query, so the editor auto-runs
  // a Discogs search after a debounce. During that debounce window — before the request even
  // starts — the badge must already read "Checking…", never a momentary "not in library".
  it('shows checking from the moment a track with a query opens, before the search even fires', () => {
    setApi()
    const owned = buildLibraryIndex([{ title: 'Track Two (Remix)', artist: 'The Artist' }])
    renderEditor(
      {
        id: 'a',
        query: 'some album',
        meta: { title: 'track two remix', artist: 'Wrong Tag Artist' },
      },
      'wav',
      { libraryIndex: owned },
    )
    // Synchronous, right after mount: the 500ms debounce hasn't fired, so no request is in
    // flight yet — but the verdict is still pending, so it must not read negative.
    expect(screen.getByTestId('apple-music-status')).toHaveTextContent('Checking…')
  })

  // The other end of that state: once the search settles with no owning match, the badge
  // commits to the negative — "Checking…" is only ever transient.
  it('commits to the negative once the search settles without an owning match', async () => {
    setApi()
    const owned = buildLibraryIndex([{ title: 'Something Else', artist: 'Nobody' }])
    renderEditor(
      { id: 'a', meta: { title: 'track two remix', artist: 'Wrong Tag Artist' } },
      'wav',
      {
        libraryIndex: owned,
      },
    )
    fireEvent.change(screen.getByTestId('discogs-query'), { target: { value: 'some album' } })
    fireEvent.keyDown(screen.getByTestId('discogs-query'), { key: 'Enter' })
    await screen.findByTestId('discogs-result')
    await waitFor(() =>
      expect(screen.getByTestId('apple-music-status')).toHaveTextContent(
        'Not in library',
      ),
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
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ title: 'Pepito de los palotes2025' }) }),
    )
  })

  // The title-format row is the single-track twin of the ⌘K bulk apply: it rewrites
  // the title from the settings pattern, previewing the exact result — and that
  // preview is the safeguard: re-applying a prefix pattern stacks it, and the row
  // shows the stacked outcome before the user commits.
  it('rewrites the title from the settings title format via the ⋯ menu', () => {
    const { onChange } = renderEditor(
      { id: 't1', meta: { title: 'Action (Base)', trackNumber: 'B2' } },
      'wav',
      { visibleFields: ['title', 'trackNumber'], titleFormat: '({trackNumber}) {title}' },
    )
    fireEvent.click(screen.getByTestId('field-insert-title'))
    fireEvent.click(screen.getByTestId('field-insert-option-title-format'))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ title: '(B2) Action (Base)' }) }),
    )
  })

  it('offers no title-format row when the pattern leaves the title as it is', () => {
    // A no-op row ("apply" that changes nothing) would make the menu feel broken.
    renderEditor({ id: 't1', meta: { title: 'Action (Base)' } }, 'wav', {
      visibleFields: ['title'],
      titleFormat: '{title}',
    })
    fireEvent.click(screen.getByTestId('field-insert-title'))
    expect(screen.queryByTestId('field-insert-option-title-format')).toBeNull()
  })

  it('offers no title-format row when the title already wears the pattern', () => {
    // Re-applying must never stack "(B2) (B2) …": an already-formatted title is a
    // no-op for the row, the T button and the ⌘K command alike.
    renderEditor({ id: 't1', meta: { title: '(B2) Action (Base)', trackNumber: 'B2' } }, 'wav', {
      visibleFields: ['title', 'trackNumber'],
      titleFormat: '({trackNumber}) {title}',
    })
    fireEvent.click(screen.getByTestId('field-insert-title'))
    expect(screen.queryByTestId('field-insert-option-title-format')).toBeNull()
  })

  // The header button is the bulk twin of the menu row: one click hands the whole
  // pass to App's applyTitleFormat, which owns the undo channel and the "changed
  // n / changed nothing" notices. Hidden when no format is configured.
  it('triggers the title-format pass from the header button', () => {
    const { onApplyTitleFormat } = renderEditor(
      { id: 't1', meta: { title: 'Action (Base)', trackNumber: 'B2' } },
      'wav',
      { visibleFields: ['title', 'trackNumber'], titleFormat: '({trackNumber}) {title}' },
    )
    fireEvent.click(screen.getByTestId('apply-title-format-btn'))
    expect(onApplyTitleFormat).toHaveBeenCalledOnce()
  })

  it('hides the title-format header button when no format is configured', () => {
    renderEditor({ id: 't1', meta: { title: 'Action (Base)' } }, 'wav', {
      visibleFields: ['title'],
    })
    expect(screen.queryByTestId('apply-title-format-btn')).toBeNull()
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
  it('offers the menu on free-text fields only, never on structured ones', () => {
    renderEditor({ id: 't1', meta: { title: 'Pepito de los palotes', year: '2025' } }, 'wav', {
      visibleFields: ['title', 'publisher', 'year'],
    })
    expect(screen.getByTestId('field-insert-title')).toBeInTheDocument()
    expect(screen.getByTestId('field-insert-publisher')).toBeInTheDocument()
    expect(screen.queryByTestId('field-insert-year')).toBeNull()
  })
})

describe('Editor Discogs format filter hint', () => {
  // When a format filter is active (Settings → Search), the Discogs column flags it with a
  // discreet funnel icon, so a thinned or empty result list reads as the filter at work
  // rather than a broken search — without a line of text repeating a setting the user chose.
  it('flags an active format filter with the funnel control, naming the formats on hover', async () => {
    renderEditor({ id: 'a' }, 'wav', { discogsFormats: ['Vinyl', 'CD'] })
    const filter = screen.getByTestId('discogs-format-filter')
    expect(filter).toBeInTheDocument()
    // The formats live in the themed tooltip, surfaced on hover, not as always-on text.
    for (const type of ['pointerenter', 'pointermove']) {
      filter.dispatchEvent(new MouseEvent(type, { clientX: 10, clientY: 10, bubbles: true }))
    }
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('Vinyl')
    expect(tip).toHaveTextContent('CD')
  })

  // The filter is a Settings preference, so the control takes the user to where it's
  // changed rather than clearing it from under them.
  it('opens Settings → Search when the filter control is clicked', () => {
    const { onOpenSettings } = renderEditor({ id: 'a' }, 'wav', { discogsFormats: ['Vinyl'] })
    fireEvent.click(screen.getByTestId('discogs-format-filter'))
    expect(onOpenSettings).toHaveBeenCalledWith('search')
  })

  it('shows no format control when no filter is set', () => {
    renderEditor({ id: 'a' }, 'wav', { discogsFormats: [] })
    expect(screen.queryByTestId('discogs-format-filter')).toBeNull()
  })
})

// The user's ask, verbatim: sections need definition and SPACE to work — so any
// wave-work section can take over the whole window. The state lives in the
// module store, so the overlay survives track switches: maximize the trim,
// arrow through the list, review every cut full-screen.
describe('Editor maximized section', () => {
  it('maximizes a section into a full-window overlay and Esc restores it', async () => {
    renderEditor({ id: 'a' })
    const section = screen.getByTestId('editor-trim')
    fireEvent.click(within(section).getByTestId('section-maximize'))
    const overlay = await screen.findByTestId('section-maximized-overlay')
    expect(within(overlay).getByTestId('editor-trim')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('section-maximized-overlay')).not.toBeInTheDocument()
    expect(screen.getByTestId('editor-trim')).toBeInTheDocument()
  })

  // Every section that draws a full-length wave earns the toggle: trim, click
  // repair (its clicks-found strip), loudness (its before/after preview) and the
  // quality spectrogram all read better full-window. A text-only section doesn't.
  it('offers maximize on every wave-work section and none on the rest', () => {
    renderEditor({ id: 'a' })
    // The rule is "a section with a full-length waveform earns the whole window":
    // trim, declick and loudness all draw one, so all three maximize — leaving the
    // toggle off declick/loudness (as it used to be) made "which sections zoom?"
    // arbitrary. A text-only section like File name has nothing to blow up.
    for (const id of ['editor-trim', 'editor-declick', 'editor-normalize']) {
      expect(
        within(screen.getByTestId(id)).getByTestId('section-maximize'),
      ).toBeInTheDocument()
    }
    // The File name section draws no wave, so it never grows the maximize toggle.
    const output = screen.getByTestId('output-name').closest('div[class*="border-t"]')
    expect(output && within(output as HTMLElement).queryByTestId('section-maximize')).toBeFalsy()
  })
})

// The editor is a flat list of same-weight sections; the group headings make its
// three phases (describe the file → operate on the audio → name the output) visible
// so the eye can find where audio work begins instead of scanning every header.
describe('Editor section groups', () => {
  it('labels a group heading at each phase of the default section order', () => {
    renderEditor({ id: 'a' })
    // The pinned metadata form opens File; the audio sections and the file-name
    // section each announce their phase as the group changes down the list.
    expect(screen.getByTestId('editor-group-metadata')).toBeInTheDocument()
    expect(screen.getByTestId('editor-group-audio')).toBeInTheDocument()
    expect(screen.getByTestId('editor-group-output')).toBeInTheDocument()
  })

  it('opens the audio phase right before the first audio section', () => {
    renderEditor({ id: 'a' })
    // The heading sits immediately above Silence trim (the first audio section in
    // default order): the label belongs to the section it introduces, not floating.
    const audio = screen.getByTestId('editor-group-audio')
    const trim = screen.getByTestId('editor-trim')
    expect(audio.compareDocumentPosition(trim) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(trim.compareDocumentPosition(audio) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })
})
