// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { createRef, useLayoutEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { DEFAULT_EDITOR_SECTIONS } from '../../../shared/editorSections'
import { emptyMetadata } from '../../../shared/metadata'
import type {
  DeclickConfig,
  FormatSetting,
  KeyNotation,
  LoudnessResult,
  NormalizeConfig,
  Settings,
  TrackMetadata,
  TrackProperties,
} from '../../../shared/types'
import { resetEditorSections } from '../hooks/useEditorSections'
import i18n from '../i18n'
import { type AppleMusicIndex, buildLibraryIndex } from '../lib/appleMusicLibrary'
import { convertGate } from '../lib/batch'
import { coverSourceOf } from '../lib/coverSource'
import { trackSignature } from '../lib/dirty'
import { resetEditorPlace } from '../lib/editorPlace'
import { OpenSettingsProvider } from '../lib/openSettingsContext'
import type { PhrasedComment } from '../lib/phraseCountBatch'
import { createQueryClient } from '../lib/queryClient'
import { SettingsProvider } from '../lib/settingsContext'
import { runKeyClaim } from '../lib/spaceClaim'
import type { TrackItem } from '../types'

// TrimSection (rendered by Editor) reads window.api.platform at module load, so stub
// it before the component is imported.
vi.hoisted(() => {
  ;(globalThis.window as unknown as { api: unknown }).api = { platform: 'win32' }
})

import { djReads, type ProgramReads } from '../test/api'
import { hoverTooltip } from '../test/tooltip'
import { Editor } from './Editor'

vi.mock('../lib/batch', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/batch')>()
  return { ...real, convertGate: vi.fn(real.convertGate) }
})

afterEach(cleanup)

// Raise a hover tooltip and wait out its deliberate pause in fake time, so the tooltip's
// 400ms delay never eats the waiting budget. jsdom's synthetic PointerEvent drops
// clientX/clientY, so drive the listener with MouseEvents, entering before moving — the
// cursor-tracking listeners are bound lazily on pointerenter. Timers are faked only inside
// each attempt, since faking them across the caller's async setup would strand the pending
// API promises these tests await.
// The hover is retried until the tooltip shows because the trigger usually arrives from an
// async render outside act: findBy* resolves on the DOM commit, but the Tooltip binds its
// pointerenter listener in a passive effect React may not have flushed yet on a loaded
// runner, and a hover dispatched into that gap raises nothing.
async function hoverForTooltip(trigger: HTMLElement): Promise<HTMLElement> {
  return waitFor(() => {
    vi.useFakeTimers()
    try {
      for (const type of ['pointerenter', 'pointermove']) {
        trigger.dispatchEvent(new MouseEvent(type, { clientX: 10, clientY: 10, bubbles: true }))
      }
      act(() => vi.advanceTimersByTime(400))
    } finally {
      vi.useRealTimers()
    }
    return screen.getByRole('tooltip')
  })
}

// The Editor's read-only data (currently Properties) is fetched through React Query,
// so every mount needs a client in context. A fresh client per render keeps tests
// isolated; retry:false lets a rejected probe settle into isError within waitFor.
function renderWithQuery(
  ui: React.ReactElement,
  settings: Partial<Settings> = {},
): ReturnType<typeof render> & {
  changeSettings: (next: Partial<Settings>) => void
  rerenderUi: (next: React.ReactElement) => void
} {
  const client = createQueryClient()
  // The editor reads its Settings-derived values from the shared context now, so the
  // per-test overrides ride a provider instead of an 17-prop wall on <Editor>.
  const tree = (current: Partial<Settings>, content: React.ReactElement = ui) => (
    <QueryClientProvider client={client}>
      <SettingsProvider settings={{ discogsToken: 'tok', showSpectrum: false, ...current }}>
        {content}
      </SettingsProvider>
    </QueryClientProvider>
  )
  const result = render(tree(settings))
  return Object.assign(result, {
    changeSettings: (next: Partial<Settings>) => result.rerender(tree({ ...settings, ...next })),
    rerenderUi: (next: React.ReactElement) => result.rerender(tree(settings, next)),
  })
}

// Editor mounts effects that touch window.api; a non-darwin platform skips the
// Apple Music lookup and showSpectrum={false} skips the spectrogram analysis, so
// the bridge only needs `platform` and the handful of methods used on click.
beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    platform: 'win32',
    peekAnalysis: vi.fn().mockResolvedValue(null),
    clicks: vi.fn().mockResolvedValue(null),
    // The repair section subscribes to render progress on mount, so the bridge
    // must hand back an unsubscribe even in tests that never open it.
    onDeclickPreviewProgress: vi.fn().mockReturnValue(() => {}),
    cancelDeclickPreview: vi.fn().mockResolvedValue(undefined),
    reveal: vi.fn(),
    recordStat: vi.fn(),
    // The library verdict reads where an offered replacement's file lives the moment the
    // copy is offered, so this effect mounts wherever a library index is handed in.
    appleMusicEntryLocation: vi.fn().mockResolvedValue(''),
    appleMusicEntryMeta: vi.fn().mockResolvedValue(null),
    // The editor asks main whether a library copy is the open file under another path.
    sameFile: vi.fn(async (a: string, b: string) => a === b),
    readTags: vi.fn().mockRejectedValue(new Error('no library copy in this test')),
    readCoverFull: vi.fn().mockResolvedValue(null),
    // CoverPicker preloads a draggable file whenever the track has artwork, so any test
    // that gives one a cover mounts this effect.
    prepareCoverDrag: vi.fn().mockResolvedValue(null),
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
    cues: { onCommentProgress: vi.fn(() => () => {}) },
    dj: djReads({
      rekordbox: { available: vi.fn<ProgramReads['available']>().mockResolvedValue(false) },
    }),
  }
  // Section fold state persists in a module store across editor remounts; reset it so a
  // section a previous test toggled doesn't start the next one in the opposite state.
  resetEditorSections()
  resetEditorPlace()
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
  outputFormat: FormatSetting = 'wav',
  props: {
    requiredFields?: string[]
    visibleFields?: string[]
    genrePresets?: string[]
    genreSeparator?: string
    showLoudness?: boolean
    showSpectrum?: boolean
    normalize?: NormalizeConfig
    declick?: DeclickConfig
    showEditorHints?: boolean
    overwriteOriginal?: boolean
    backupPolicy?: Settings['backupPolicy']
    rememberedPick?: React.ComponentProps<typeof Editor>['rememberedPick']
    addToAppleMusic?: boolean
    addToEngineDj?: boolean
    addToTraktor?: boolean
    addToRekordbox?: boolean
    syncRekordbox?: boolean
    syncTraktor?: boolean
    syncSerato?: boolean
    traktorNmlPath?: string
    keepMp3Sources?: boolean
    keyNotation?: KeyNotation
    discogsFormats?: string[]
    libraryIndex?: AppleMusicIndex | null
    libraryLoading?: boolean
    replaceLowResCover?: boolean
    autoApplyFilename?: boolean
    filenameFormat?: string
    titleFormat?: string
    editorSections?: Settings['editorSections']
    customFields?: Settings['customFields']
    discogsToken?: string
    searchProviders?: Settings['searchProviders']
    outputDir?: string
    convertBesideOriginal?: boolean
    autoMatch?: boolean
    rekordboxCue?: React.ComponentProps<typeof Editor>['rekordboxCue']
    readFullTrack?: React.ComponentProps<typeof Editor>['readFullTrack']
    resultsFolded?: boolean
    copiedMetaTitle?: string | null
    filesOpen?: boolean
    libraryCopyAction?: React.ComponentProps<typeof Editor>['libraryCopyAction']
  } = {},
): {
  onProcess: ReturnType<typeof vi.fn>
  onUpdateLibraryCopy: ReturnType<typeof vi.fn>
  onLibraryCopyAction: ReturnType<typeof vi.fn>
  onLibraryRunChange: ReturnType<typeof vi.fn>
  onChange: ReturnType<typeof vi.fn>
  onDeriveTags: ReturnType<typeof vi.fn>
  onApplyTitleFormat: ReturnType<typeof vi.fn>
  onFormatChange: ReturnType<typeof vi.fn>
  onDestinationChange: ReturnType<typeof vi.fn>
  onCleanUp: ReturnType<typeof vi.fn>
  onOpenSettings: ReturnType<typeof vi.fn>
  onShowLoudnessHelp: ReturnType<typeof vi.fn>
  onOpenRename: ReturnType<typeof vi.fn>
  onRegenerateName: ReturnType<typeof vi.fn>
  onCopyFilename: ReturnType<typeof vi.fn>
  onCopyPath: ReturnType<typeof vi.fn>
  onSearchWeb: ReturnType<typeof vi.fn>
  onCopyMeta: ReturnType<typeof vi.fn>
  onPasteMeta: ReturnType<typeof vi.fn>
  onExportCollection: ReturnType<typeof vi.fn>
  onRecordUndo: ReturnType<typeof vi.fn>
  onFoldResults: ReturnType<typeof vi.fn>
  changeSettings: (next: Partial<Settings>) => void
  setFilesOpen: (filesOpen: boolean) => void
  unmount: () => void
} {
  const onProcess = vi.fn()
  const onUpdateLibraryCopy = vi.fn()
  const onLibraryCopyAction = vi.fn()
  const onLibraryRunChange = vi.fn()
  const onFoldResults = vi.fn()
  const onRecordUndo = vi.fn()
  const onChange = vi.fn()
  const onDeriveTags = vi.fn()
  const onApplyTitleFormat = vi.fn()
  const onFormatChange = vi.fn()
  const onDestinationChange = vi.fn()
  const onCleanUp = vi.fn()
  const onOpenSettings = vi.fn()
  const onShowLoudnessHelp = vi.fn()
  const onOpenRename = vi.fn()
  const onRegenerateName = vi.fn()
  const onCopyFilename = vi.fn()
  const onCopyPath = vi.fn()
  const onSearchWeb = vi.fn()
  const onCopyMeta = vi.fn()
  const onPasteMeta = vi.fn()
  const onExportCollection = vi.fn()
  // The panel reads "open Settings" from context now, so the spy rides a provider
  // exactly as App mounts it.
  const ui = (filesOpen: boolean) => (
    <OpenSettingsProvider open={onOpenSettings}>
      <Editor
        item={item(over)}
        libraryIndex={props.libraryIndex ?? null}
        libraryLoading={props.libraryLoading}
        rekordboxCue={props.rekordboxCue}
        searchInputRef={createRef<HTMLInputElement>()}
        onChange={onChange}
        onProcess={onProcess}
        libraryCopyAction={props.libraryCopyAction}
        onUpdateLibraryCopy={onUpdateLibraryCopy}
        onLibraryCopyAction={onLibraryCopyAction}
        onLibraryRunChange={onLibraryRunChange}
        onFormatChange={onFormatChange}
        onDestinationChange={onDestinationChange}
        rememberedPick={props.rememberedPick}
        onDeriveTags={onDeriveTags}
        onApplyTitleFormat={onApplyTitleFormat}
        onAddToAppleMusic={vi.fn()}
        onCleanUp={onCleanUp}
        resultsFolded={props.resultsFolded ?? false}
        onFoldResults={onFoldResults}
        onResultsResizeStart={vi.fn()}
        onResultsFit={vi.fn()}
        onShowLoudnessHelp={onShowLoudnessHelp}
        onHideEditorHints={vi.fn()}
        onOpenRename={onOpenRename}
        onRegenerateName={onRegenerateName}
        onTrimDetectedAll={vi.fn()}
        onCopyFilename={onCopyFilename}
        onCopyPath={onCopyPath}
        onSearchWeb={onSearchWeb}
        onCopyMeta={onCopyMeta}
        onPasteMeta={onPasteMeta}
        copiedMetaTitle={props.copiedMetaTitle ?? null}
        onExportCollection={onExportCollection}
        onRecordUndo={onRecordUndo}
        readFullTrack={props.readFullTrack ?? (async () => undefined)}
        filesOpen={filesOpen}
      />
    </OpenSettingsProvider>
  )
  const { changeSettings, rerenderUi, unmount } = renderWithQuery(ui(props.filesOpen ?? true), {
    outputFormat,
    // The membership badge follows the conversion destination now; Apple Music (the
    // pre-destination-aware behaviour every badge test was written against) unless a
    // test opts into another destination.
    addToAppleMusic: props.addToAppleMusic ?? true,
    addToEngineDj: props.addToEngineDj ?? false,
    addToTraktor: props.addToTraktor ?? false,
    addToRekordbox: props.addToRekordbox ?? false,
    ...(props.syncRekordbox ? { syncRekordbox: true } : {}),
    ...(props.syncTraktor ? { syncTraktor: true } : {}),
    ...(props.syncSerato ? { syncSerato: true } : {}),
    traktorNmlPath: props.traktorNmlPath ?? '',
    keepMp3Sources: props.keepMp3Sources ?? false,
    overwriteOriginal: props.overwriteOriginal ?? false,
    ...(props.backupPolicy ? { backupPolicy: props.backupPolicy } : {}),
    replaceLowResCover: props.replaceLowResCover ?? false,
    autoApplyFilename: props.autoApplyFilename ?? false,
    filenameFormat: props.filenameFormat ?? '{artist} - {title}',
    titleFormat: props.titleFormat ?? '',
    genrePresets: props.genrePresets ?? [],
    ...(props.genreSeparator ? { genreSeparator: props.genreSeparator } : {}),
    groupingPresets: [],
    visibleFields: props.visibleFields ?? [],
    customFields: props.customFields ?? [],
    requiredFields: props.requiredFields ?? [],
    discogsFormats: props.discogsFormats ?? [],
    discogsMaxResults: 25,
    showLoudness: props.showLoudness ?? false,
    ...(props.showSpectrum ? { showSpectrum: true } : {}),
    keyNotation: props.keyNotation ?? 'camelot',
    normalize: props.normalize ?? { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
    ...(props.declick ? { declick: props.declick } : {}),
    ...(props.showEditorHints !== undefined ? { showEditorHints: props.showEditorHints } : {}),
    ...(props.editorSections ? { editorSections: props.editorSections } : {}),
    ...(props.discogsToken !== undefined ? { discogsToken: props.discogsToken } : {}),
    ...(props.searchProviders ? { searchProviders: props.searchProviders } : {}),
    ...(props.outputDir ? { outputDir: props.outputDir } : {}),
    ...(props.convertBesideOriginal ? { convertBesideOriginal: true } : {}),
    ...(props.autoMatch ? { autoMatch: true } : {}),
  })
  return {
    onProcess,
    onUpdateLibraryCopy,
    onLibraryCopyAction,
    onLibraryRunChange,
    onChange,
    onExportCollection,
    onDeriveTags,
    onApplyTitleFormat,
    onFormatChange,
    onDestinationChange,
    onCleanUp,
    onOpenSettings,
    onShowLoudnessHelp,
    onOpenRename,
    onRegenerateName,
    onCopyFilename,
    onCopyPath,
    onSearchWeb,
    onCopyMeta,
    onPasteMeta,
    onRecordUndo,
    onFoldResults,
    changeSettings,
    setFilesOpen: (filesOpen: boolean) => rerenderUi(ui(filesOpen)),
    unmount,
  }
}

describe('Editor cues section', () => {
  beforeEach(() => {
    Object.assign((window as unknown as { api: { cues: object } }).api.cues, {
      trackCues: vi.fn<Api['cues']['trackCues']>().mockResolvedValue(null),
      queued: vi.fn<Api['cues']['queued']>().mockResolvedValue(null),
      waveDetail: vi.fn<Api['cues']['waveDetail']>().mockResolvedValue(null),
    })
    Object.assign((window as unknown as { api: object }).api, {
      cueProfile: vi.fn<Api['cueProfile']>().mockResolvedValue({
        profile: null,
        edits: { count: 0, sinceLearn: 0, corrected: 0 },
        marked: 0,
      }),
      onCueProfileChanged: () => () => {},
      onReplacedChanged: () => () => {},
    })
  })

  it('writes the phrases between the CALLs into the comment as one undoable edit', async () => {
    const grid = Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
    Object.assign((window as unknown as { api: { cues: object } }).api.cues, {
      trackCues: vi.fn<Api['cues']['trackCues']>().mockResolvedValue({
        contentId: '103',
        analysed: true,
        grid,
        strong: [],
        phrases: [],
        cues: [0, 64, 320].map((b) => ({ id: `c${b}`, ms: b * 500, kind: 0, color: null })),
        wave: null,
        durationMs: 400000,
        fingerprint: 'f0',
        gridFingerprint: '',
      }),
    })
    const { onChange, onRecordUndo } = renderEditor(
      { id: 'a', meta: { title: 'Pray', comment: 'Vocal fuerte' } },
      'wav',
      { rekordboxCue: { contentId: '103', path: '/music/a.wav', label: 'a' } },
    )
    fireEvent.click(await screen.findByTestId('phrase-count-apply'))
    expect(onRecordUndo).toHaveBeenCalledWith(['a'])
    expect(onChange).toHaveBeenLastCalledWith({
      meta: expect.objectContaining({ comment: '2 - 8 · Vocal fuerte' }),
    })
  })

  it('maximizes into the full cue editor with the track title, artist, BPM and key', async () => {
    const grid = Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
    Object.assign((window as unknown as { api: { cues: object } }).api.cues, {
      trackCues: vi.fn<Api['cues']['trackCues']>().mockResolvedValue({
        contentId: '103',
        analysed: true,
        grid,
        strong: [],
        phrases: [],
        cues: [],
        wave: null,
        durationMs: 400000,
        fingerprint: 'f0',
        gridFingerprint: '',
      }),
    })
    renderEditor(
      { id: 'a', meta: { title: 'Pray', artist: 'Gowan', bpm: '120', key: '6A' } },
      'wav',
      {
        rekordboxCue: { contentId: '103', path: '/music/a.wav', label: 'a' },
      },
    )
    await waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
    fireEvent.click(within(screen.getByTestId('cues-section')).getByTestId('section-maximize'))
    const header = await screen.findByTestId('cues-header')
    expect(header).toHaveTextContent('Pray')
    expect(header).toHaveTextContent('Gowan')
    expect(header).toHaveTextContent('120 BPM')
    expect(header).toHaveTextContent('6A')
    expect(screen.getByTestId('section-maximized-overlay')).toContainElement(header)
  })

  it('heads the full cue editor with the rekordbox artwork when the file carries none, as the list row does', async () => {
    const grid = Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
    Object.assign((window as unknown as { api: { cues: object } }).api.cues, {
      trackCues: vi.fn<Api['cues']['trackCues']>().mockResolvedValue({
        contentId: '103',
        analysed: true,
        grid,
        strong: [],
        phrases: [],
        cues: [],
        wave: null,
        durationMs: 400000,
        fingerprint: 'f0',
        gridFingerprint: '',
      }),
    })
    renderEditor(
      {
        id: 'a',
        meta: { title: 'Purrrr...' },
        sourcePreview: {
          title: 'Purrrr...',
          artist: 'The King Of House',
          durationSec: 253,
          coverUrl: 'surco-media:///rekordbox/artwork/purrrr.jpg',
          cues: [],
        },
      },
      'wav',
      { rekordboxCue: { contentId: '103', path: '/music/a.wav', label: 'a' } },
    )
    await waitFor(() => expect(screen.getByTestId('cue-wave')).toBeInTheDocument())
    fireEvent.click(within(screen.getByTestId('cues-section')).getByTestId('section-maximize'))
    expect(await screen.findByTestId('cues-cover')).toHaveAttribute(
      'src',
      'surco-media:///rekordbox/artwork/purrrr.jpg',
    )
  })

  it('is absent for a track that is not in an open rekordbox playlist', () => {
    renderEditor({ id: 'a' })
    expect(screen.queryByTestId('cues-section')).toBeNull()
    expect(screen.queryByTestId('cues-single-only')).toBeNull()
  })

  it('shows for a single track of an open rekordbox playlist', () => {
    renderEditor({ id: 'a' }, 'wav', {
      rekordboxCue: { contentId: '103', path: '/music/a.wav', label: 'a' },
    })
    expect(screen.getByTestId('cues-section')).toBeInTheDocument()
  })

  const follows = (a: string, b: string) =>
    (screen.getAllByTestId(a)[0].compareDocumentPosition(screen.getAllByTestId(b)[0]) &
      Node.DOCUMENT_POSITION_FOLLOWING) !==
    0

  it('keeps Cues where Settings › Sections lists it in a rekordbox playlist, after the metadata, so the editor matches that list', () => {
    renderEditor({ id: 'a' }, 'wav', {
      rekordboxCue: { contentId: '103', path: '/music/a.wav', label: 'a' },
    })
    expect(follows('editor-group-metadata', 'cues-section')).toBe(true)
    expect(screen.getAllByTestId('cues-section')).toHaveLength(1)
  })

  it('keeps the order the DJ arranged in Settings, Cues included, instead of lifting it', () => {
    const custom = [
      ...DEFAULT_EDITOR_SECTIONS.filter((s) => s.id !== 'cues' && s.id !== 'output'),
      { id: 'cues' as const, open: true },
      { id: 'output' as const, open: true },
    ]
    renderEditor({ id: 'a' }, 'wav', {
      rekordboxCue: { contentId: '103', path: '/music/a.wav', label: 'a' },
      editorSections: custom,
    })
    expect(follows('editor-group-metadata', 'cues-section')).toBe(true)
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

  it('records the cover before a change by hand, so ⌘Z can bring the old artwork back', () => {
    ;(window as unknown as { api: Record<string, unknown> }).api.prepareCoverDrag = () =>
      Promise.resolve('/tmp/c.jpg')
    const { onChange, onRecordUndo } = renderEditor({
      id: 'a',
      coverUrl: 'data:image/png;base64,xxx',
    })
    fireEvent.click(screen.getByTestId('cover-remove'))
    expect(onRecordUndo).toHaveBeenCalledWith(['a'], { cover: true })
    expect(onRecordUndo.mock.invocationCallOrder[0]).toBeLessThan(
      onChange.mock.invocationCallOrder[0],
    )
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
  it('opens the cover large when the thumbnail is clicked and closes it from the backdrop', async () => {
    ;(window as unknown as { api: Record<string, unknown> }).api.prepareCoverDrag = () =>
      Promise.resolve(null)
    renderEditor({ id: 'a', coverUrl: 'blob:cover' })
    fireEvent.click(screen.getByTestId('cover-zoom'))
    expect(screen.getByTestId('cover-lightbox-img')).toHaveAttribute('src', 'blob:cover')
    fireEvent.click(screen.getByTestId('cover-lightbox-backdrop'))
    await waitFor(() => expect(screen.queryByTestId('cover-lightbox-img')).not.toBeInTheDocument())
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

// The header keeps the two tag actions in sight; the rest of its glyphs live in one menu,
// opened here before reaching for any of them.
const openMore = (): void => {
  if (!screen.queryByRole('menu')) fireEvent.click(screen.getByTestId('meta-more'))
}

describe('Restoring the tags a release replaced', () => {
  const applied = {
    before: { title: 'My Title', album: 'My Album', year: '' },
    wrote: { title: 'Release Title', album: 'Release Album', year: '1999' },
  }

  // The struck-through line under every field cluttered the form after each match; one
  // action in More gives the same way back, and Undo covers the rest.
  it('draws no previous value under the fields a release changed', () => {
    renderEditor(
      {
        id: 'a',
        meta: { title: 'Release Title', album: 'Release Album', year: '1999' },
        appliedRelease: applied,
      },
      'wav',
      { visibleFields: ['title', 'album', 'year'] },
    )
    expect(screen.getByTestId('field-title')).toHaveValue('Release Title')
    expect(screen.queryByTestId('field-title-previous')).toBeNull()
    expect(screen.queryByTestId('field-album-previous')).toBeNull()
  })

  // Copy and Paste are a pair; the release restore is a different kind of action, so it
  // sits after them instead of splitting the pair.
  it('lists the restore after Paste so Copy and Paste stay together', () => {
    renderEditor(
      {
        id: 'a',
        meta: { title: 'Release Title', album: 'Release Album', year: '1999' },
        appliedRelease: applied,
      },
      'wav',
      { visibleFields: ['title', 'album', 'year'] },
    )
    openMore()
    const ids = screen.getAllByRole('menuitem').map((el) => el.getAttribute('data-testid'))
    expect(ids.indexOf('restore-release-btn')).toBe(ids.indexOf('paste-meta-btn') + 1)
  })

  // One click, one Undo step: restoring field by field would need one ⌘Z per field. A field
  // the release filled goes back to empty too: the action promises the tags from before, and
  // leaving the release's year behind would keep a value the user just asked to drop.
  it('puts every replaced field back, empty ones included, in a single patch and a single Undo step', () => {
    const { onChange, onRecordUndo } = renderEditor(
      {
        id: 'a',
        meta: { title: 'Release Title', album: 'Release Album', year: '1999' },
        appliedRelease: applied,
      },
      'wav',
      { visibleFields: ['title', 'album', 'year'] },
    )
    openMore()
    fireEvent.click(screen.getByTestId('restore-release-btn'))
    expect(onRecordUndo).toHaveBeenCalledTimes(1)
    expect(onRecordUndo.mock.calls[0][0]).toEqual(['a'])
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].meta).toMatchObject({
      title: 'My Title',
      album: 'My Album',
      year: '',
    })
  })

  // A title the user rewrote after the match is theirs; restoring must not undo their work.
  it('leaves alone a field the user changed after the release', () => {
    const { onChange } = renderEditor(
      {
        id: 'a',
        meta: { title: 'My Own Edit', album: 'Release Album', year: '1999' },
        appliedRelease: applied,
      },
      'wav',
      { visibleFields: ['title', 'album', 'year'] },
    )
    openMore()
    fireEvent.click(screen.getByTestId('restore-release-btn'))
    expect(onChange.mock.calls[0][0].meta).toMatchObject({
      title: 'My Own Edit',
      album: 'My Album',
    })
  })

  // The release also stamps where it came from (the Discogs id and address). Those stay
  // after the DJ has put every tag back by hand, and alone they kept the action offered for
  // good; they go back with the tags, but never keep the action alive on their own.
  describe('with the release id and address it stamped', () => {
    const stamped = {
      before: { title: 'My Title', discogsReleaseId: '', discogsUrl: '' },
      wrote: {
        title: 'Release Title',
        discogsReleaseId: '2',
        discogsUrl: 'https://www.discogs.com/release/2',
      },
    }
    const stampedMeta = { discogsReleaseId: '2', discogsUrl: 'https://www.discogs.com/release/2' }

    it('is not offered once only the id and address are left', () => {
      renderEditor(
        { id: 'a', meta: { title: 'My Title', ...stampedMeta }, appliedRelease: stamped },
        'wav',
        { visibleFields: ['title'] },
      )
      openMore()
      expect(screen.queryByTestId('restore-release-btn')).toBeNull()
    })

    it('empties the id and address along with the tags it restores', () => {
      const { onChange } = renderEditor(
        { id: 'a', meta: { title: 'Release Title', ...stampedMeta }, appliedRelease: stamped },
        'wav',
        { visibleFields: ['title'] },
      )
      openMore()
      fireEvent.click(screen.getByTestId('restore-release-btn'))
      expect(onChange.mock.calls[0][0].meta).toMatchObject({
        title: 'My Title',
        discogsReleaseId: '',
        discogsUrl: '',
      })
    })
  })

  it('is not offered when no release was applied', () => {
    renderEditor({ id: 'a', meta: { title: 'Strobe' } })
    openMore()
    expect(screen.queryByTestId('restore-release-btn')).toBeNull()
  })

  it('is not offered once every replaced field is back or changed by the user', () => {
    renderEditor(
      {
        id: 'a',
        meta: { title: 'Mine', album: 'Mine too', year: '2005' },
        appliedRelease: applied,
      },
      'wav',
      { visibleFields: ['title', 'album', 'year'] },
    )
    openMore()
    expect(screen.queryByTestId('restore-release-btn')).toBeNull()
  })
})

describe('Editor metadata header', () => {
  // With a library tree and the results column open in the smallest window the editor is
  // 262 px wide: the two named actions ran over the section title and off the panel's edge.
  it('keeps the fill and clear actions as bare icons with their names when the editor is too narrow for the words', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private cb: ResizeObserverCallback) {}
        observe(): void {
          this.cb(
            [{ contentRect: { width: 262 } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          )
        }
        disconnect(): void {}
      },
    )
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav')
    expect(screen.getByTestId('derive-btn')).not.toHaveTextContent('Fill from filename')
    expect(screen.getByTestId('derive-btn')).toHaveAccessibleName('Fill from filename')
    expect(screen.getByTestId('clear-meta-btn')).not.toHaveTextContent('Clear')
    expect(screen.getByTestId('clear-meta-btn')).toHaveAccessibleName(/clear/i)
    vi.unstubAllGlobals()
  })

  // Eight bare glyphs in a row told nobody which one empties every field: the two tag
  // actions are named in the header and the file and clipboard ones wait in one menu, so
  // the eraser is never a pixel away from "paste".
  it('names the fill and clear actions and tucks the other glyphs into one menu', () => {
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav')
    expect(screen.getByTestId('derive-btn')).toHaveTextContent('Fill from filename')
    expect(screen.getByTestId('clear-meta-btn')).toHaveTextContent('Clear')
    expect(screen.queryByTestId('reveal-file-btn')).toBeNull()
    expect(screen.queryByTestId('paste-meta-btn')).toBeNull()
    openMore()
    const menu = screen.getByRole('menu')
    for (const id of [
      'reveal-file-btn',
      'copy-filename-btn',
      'copy-path-btn',
      'search-web-btn',
      'copy-meta-btn',
      'paste-meta-btn',
    ]) {
      expect(menu).toContainElement(screen.getByTestId(id))
      expect(screen.getByTestId(id)).toHaveAttribute('role', 'menuitem')
    }
  })

  // The overflow menu closes the row like everywhere else, so the named actions read first and
  // the ⋯ is where the eye looks for "the rest"; wedged before Fill it split the named pair.
  it('puts the overflow menu at the end of the header, after Clear', () => {
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav')
    const more = screen.getByTestId('meta-more')
    const lastAction = more.parentElement?.parentElement?.lastElementChild
    expect(lastAction).toContainElement(more)
    expect(
      screen.getByTestId('clear-meta-btn').compareDocumentPosition(more) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('closes the menu once an action in it has run', () => {
    renderEditor({ id: 'a' })
    openMore()
    fireEvent.click(screen.getByTestId('copy-filename-btn'))
    expect(screen.queryByRole('menu')).toBeNull()
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
    openMore()
    fireEvent.click(screen.getByTestId('copy-filename-btn'))
    expect(onCopyFilename).toHaveBeenCalledTimes(1)
  })
})

describe('Editor copy path', () => {
  // Pasting the full path into a terminal or a chat is the other half of copying the name;
  // it reuses the track list's copy so the clipboard and the toast behave the same.
  it('hands the track to the shared path copy', () => {
    const { onCopyPath } = renderEditor({ id: 'a', inputPath: '/music/a.flac' })
    openMore()
    fireEvent.click(screen.getByTestId('copy-path-btn'))
    expect(onCopyPath).toHaveBeenCalledWith(expect.objectContaining({ inputPath: '/music/a.flac' }))
  })
})

describe('Editor search web', () => {
  // Copy-then-paste-into-Google was the manual chore the copy button left behind; this
  // one-click twin opens the search itself. App owns the pattern and the browser hand-off,
  // so the button just signals intent.
  it('searches the web for the file name in one click', () => {
    const { onSearchWeb } = renderEditor({ id: 'a' })
    openMore()
    fireEvent.click(screen.getByTestId('search-web-btn'))
    expect(onSearchWeb).toHaveBeenCalledTimes(1)
  })
})

describe('Editor reveal file', () => {
  // The path sat folded away in Properties and the list's right-click menu: going from the
  // track you are editing to its folder (to drag it into a player, or check its neighbours)
  // took a detour. Main checks the path against the files it handed out.
  it('shows the edited track in the file manager in one click', () => {
    renderEditor({ id: 'a', inputPath: '/music/Rave Party.aiff' })
    openMore()
    fireEvent.click(screen.getByTestId('reveal-file-btn'))
    expect(window.api.reveal).toHaveBeenCalledWith('/music/Rave Party.aiff')
  })

  it('names the file manager of the platform', () => {
    renderEditor({ id: 'a' })
    openMore()
    expect(screen.getByTestId('reveal-file-btn')).toHaveAccessibleName('Show in File Explorer')
  })
})

describe('Editor copy and paste metadata', () => {
  // Stamping one track's tags onto the next is how a release gets fixed, and the pair lived
  // only behind a right click on the list. App owns the clipboard, so the buttons signal.
  it('copies the edited track metadata in one click', () => {
    const { onCopyMeta } = renderEditor({ id: 'a' })
    openMore()
    fireEvent.click(screen.getByTestId('copy-meta-btn'))
    expect(onCopyMeta).toHaveBeenCalledTimes(1)
  })

  // The button stays put while there is nothing to paste, so the row never changes width
  // under the pointer the moment something is copied.
  it('keeps paste in place but off until something is copied', () => {
    const { onPasteMeta } = renderEditor({ id: 'a' }, 'wav', { copiedMetaTitle: null })
    openMore()
    const paste = screen.getByTestId('paste-meta-btn')
    expect(paste).toBeDisabled()
    fireEvent.click(paste)
    expect(onPasteMeta).not.toHaveBeenCalled()
  })

  // Pasting overwrites every field, so the button says which track the tags come from
  // before the click, not only in the toast after it.
  it('pastes in one click and names the track the tags come from', () => {
    const { onPasteMeta } = renderEditor({ id: 'a' }, 'wav', { copiedMetaTitle: 'Rave Party' })
    openMore()
    const paste = screen.getByTestId('paste-meta-btn')
    expect(paste).toHaveAccessibleName('Paste the metadata of “Rave Party”')
    fireEvent.click(paste)
    expect(onPasteMeta).toHaveBeenCalledTimes(1)
  })

  it('says plainly what it pastes when the copied track has no title', () => {
    renderEditor({ id: 'a' }, 'wav', { copiedMetaTitle: '' })
    openMore()
    expect(screen.getByTestId('paste-meta-btn')).toHaveAccessibleName('Paste metadata')
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
        originalArtist: '',
        lyricist: '',
        conductor: '',
        trackTotal: '',
        discTotal: '',
        copyright: '',
        encodedBy: '',
        compilation: '',
        mood: '',
        energy: '',
        style: '',
        country: '',
        mediaType: '',
        discogsUrl: '',
        quality: '',
      },
      matched: false,
      // The sweep's own flag too, or an auto-matched track never re-entered it.
      autoMatched: false,
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

  // coverRemoved only tells the NEXT export to strip the artwork; the preview keeps
  // painting coverUrl, so the image stayed on screen after a clear and the user read that
  // as "it didn't delete the cover" and went hunting for a way to remove it by hand. What
  // the editor shows has to match what the clear actually staged.
  it('takes the cover off the preview, not just off the next export', () => {
    const { onChange } = renderEditor({
      id: 'a',
      coverUrl: 'data:image/jpeg;base64,ART',
      embeddedCover: 'data:image/jpeg;base64,ART',
    })
    fireEvent.click(screen.getByTestId('clear-meta-btn'))
    const patch = onChange.mock.calls.at(-1)?.[0]
    // The key must be PRESENT and undefined: a patch that simply omits it leaves the old
    // image in place, which is the bug — so asserting the value alone would pass on it.
    expect(patch).toHaveProperty('coverUrl', undefined)
    expect(patch.coverRemoved).toBe(true)
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

describe('Editor rekordbox Playlists field', () => {
  it('stays absent while the membership loads, so a token picked then cannot shrink the track playlists to itself', async () => {
    rekordboxApiWith(vi.fn<ProgramReads['membership']>(() => new Promise(() => {})))
    renderEditor({ id: 'a' }, 'wav', { visibleFields: ['rekordboxPlaylists'] })
    await waitFor(() => expect(window.api.dj.tree).toHaveBeenCalledWith('rekordbox'))
    await waitFor(() =>
      expect(window.api.dj.membership).toHaveBeenCalledWith('rekordbox', expect.anything()),
    )
    await act(async () => {})
    expect(screen.queryByTestId('playlists-field')).toBeNull()
  })

  it('appears with the playlists the track already holds once options and membership resolve', async () => {
    rekordboxApiWith(
      vi.fn<ProgramReads['membership']>().mockResolvedValue({ '/music/a.wav': ['3000'] }),
    )
    renderEditor({ id: 'a' }, 'wav', { visibleFields: ['rekordboxPlaylists'] })
    expect(await screen.findByTestId('playlists-field')).toBeInTheDocument()
    expect(screen.getByTestId('playlists-where')).toHaveTextContent('Makina')
  })

  it('writes the picked playlist to the track as its chosen set', async () => {
    rekordboxApiWith(vi.fn<ProgramReads['membership']>().mockResolvedValue({}))
    const { onChange } = renderEditor({ id: 'a' }, 'wav', {
      visibleFields: ['rekordboxPlaylists'],
    })
    fireEvent.click(await screen.findByTestId('playlists-summary'))
    fireEvent.click(screen.getByTestId('playlists-check-3000'))
    expect(onChange).toHaveBeenCalledWith({
      playlists: { rekordbox: { targets: [{ id: '3000', name: 'Makina' }], base: [] } },
    })
  })
})

describe('Editor Traktor and Engine DJ Playlists fields', () => {
  function librariesWith(traktor: ProgramReads['membership'], engine: ProgramReads['membership']) {
    Object.assign(window.api, {
      dj: djReads({
        traktor: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: 'fri', name: 'Friday', kind: 'playlist', count: 1 }]),
          membership: traktor,
        },
        engine: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: '7', name: 'House', kind: 'playlist', count: 1 }]),
          membership: engine,
        },
      }),
      traktorCanSave: vi.fn<Api['traktorCanSave']>().mockResolvedValue(true),
    })
  }

  it('writes a pick to that library alone, as the membership it was edited against', async () => {
    librariesWith(
      vi.fn<ProgramReads['membership']>().mockResolvedValue({ '/music/a.wav': [] }),
      vi.fn<ProgramReads['membership']>().mockResolvedValue({ '/music/a.wav': ['7'] }),
    )
    const { onChange } = renderEditor({ id: 'a' }, 'wav', {
      visibleFields: ['traktorPlaylists', 'enginePlaylists'],
    })
    const traktor = await screen.findByTestId('traktor-playlists-field')
    const engine = await screen.findByTestId('engine-playlists-field')
    expect(within(engine).getByTestId('playlists-where')).toHaveTextContent('House')
    fireEvent.click(within(traktor).getByTestId('playlists-summary'))
    fireEvent.click(screen.getByTestId('playlists-check-fri'))
    expect(onChange).toHaveBeenCalledWith({
      playlists: { traktor: { targets: [{ id: 'fri', name: 'Friday' }], base: [] } },
    })
  })

  it('is offered for a track the library does not have yet, since converting adds it to the collection', async () => {
    librariesWith(
      vi.fn<ProgramReads['membership']>().mockResolvedValue({}),
      vi.fn<ProgramReads['membership']>().mockResolvedValue({}),
    )
    renderEditor({ id: 'a' }, 'wav', { visibleFields: ['traktorPlaylists', 'enginePlaylists'] })
    for (const id of ['traktor-playlists-field', 'engine-playlists-field']) {
      const field = await screen.findByTestId(id)
      await waitFor(() => expect(within(field).getByTestId('playlists-summary')).not.toBeDisabled())
    }
  })
})

describe('Editor Serato crates field', () => {
  it('picks a crate for a track Serato does not have yet', async () => {
    Object.assign(window.api, {
      dj: djReads({
        serato: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: 'A', name: 'A', kind: 'playlist', count: 0 }]),
          membership: vi.fn<ProgramReads['membership']>().mockResolvedValue({}),
        },
      }),
    })
    const { onChange } = renderEditor({ id: 'a' }, 'wav', { visibleFields: ['seratoPlaylists'] })
    const field = await screen.findByTestId('serato-playlists-field')
    await waitFor(() => expect(within(field).getByTestId('playlists-summary')).not.toBeDisabled())
    fireEvent.click(within(field).getByTestId('playlists-summary'))
    fireEvent.click(screen.getByTestId('playlists-check-A'))
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        playlists: { serato: expect.objectContaining({ targets: [{ id: 'A', name: 'A' }] }) },
      }),
    )
  })
})

describe('Editor VirtualDJ lists field', () => {
  it('picks a list for a track VirtualDJ does not have yet', async () => {
    Object.assign(window.api, {
      dj: djReads({
        virtualdj: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: 'Friday', name: 'Friday', kind: 'playlist', count: 0 }]),
          membership: vi.fn<ProgramReads['membership']>().mockResolvedValue({}),
        },
      }),
    })
    const { onChange } = renderEditor({ id: 'a' }, 'wav', { visibleFields: ['virtualdjPlaylists'] })
    const field = await screen.findByTestId('virtualdj-playlists-field')
    await waitFor(() => expect(within(field).getByTestId('playlists-summary')).not.toBeDisabled())
    fireEvent.click(within(field).getByTestId('playlists-summary'))
    fireEvent.click(screen.getByTestId('playlists-check-Friday'))
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        playlists: {
          virtualdj: expect.objectContaining({ targets: [{ id: 'Friday', name: 'Friday' }] }),
        },
      }),
    )
  })
})

describe('Editor Traktor Playlists field without a confirmed collection', () => {
  it('stays disabled and says where to choose the collection, since Surco writes only to that one', async () => {
    Object.assign(window.api, {
      dj: djReads({
        traktor: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: 'fri', name: 'Friday', kind: 'playlist', count: 1 }]),
          membership: vi
            .fn<ProgramReads['membership']>()
            .mockResolvedValue({ '/music/a.wav': ['fri'] }),
        },
      }),
      traktorCanSave: vi.fn<Api['traktorCanSave']>().mockResolvedValue(false),
    })
    renderEditor({ id: 'a' }, 'wav', { visibleFields: ['traktorPlaylists'] })
    const field = await screen.findByTestId('traktor-playlists-field')
    await waitFor(() =>
      expect(field).toHaveTextContent('Choose the collection in Settings → DJ software → Traktor'),
    )
    expect(within(field).getByTestId('playlists-summary')).toBeDisabled()
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

// The loudness table lives in the Normalize section, which ships folded.
const NORMALIZE_OPEN = [{ id: 'normalize' as const, open: true }]

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

  it('measures loudness as soon as the track opens, without a fixed wait', async () => {
    const loudness = vi.fn().mockResolvedValue(healthy)
    ;(window as unknown as { api: { loudness: unknown } }).api.loudness = loudness
    renderEditor({ id: 'a' }, 'wav', { showLoudness: true, editorSections: NORMALIZE_OPEN })
    await vi.waitFor(() => expect(loudness).toHaveBeenCalledTimes(1), { timeout: 150 })
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
    renderEditor({ id: 'a' }, 'wav', { showLoudness: true, editorSections: NORMALIZE_OPEN })
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
    renderEditor({ id: 'a' }, 'wav', { showLoudness: true, editorSections: NORMALIZE_OPEN })
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
    renderEditor({ id: 'a' }, 'wav', { showLoudness: true, editorSections: NORMALIZE_OPEN })
    await screen.findByTestId('loudness-pill-lufs')
    expect(screen.queryByTestId('loudness-pill-balance')).toBeNull()
    expect(screen.getByTestId('loudness-pill-dc')).toBeInTheDocument()
  })

  // The explainer modal is owned by App (so it gates the global shortcuts like every
  // other dialog); the editor's ⓘ button only signals the intent upward.
  it('asks App to show the explanation when the help button is pressed', async () => {
    seedLoudness(healthy)
    const { onShowLoudnessHelp } = renderEditor({ id: 'a' }, 'wav', {
      showLoudness: true,
      editorSections: NORMALIZE_OPEN,
    })
    fireEvent.click(await screen.findByTestId('loudness-help-toggle'))
    expect(onShowLoudnessHelp).toHaveBeenCalledTimes(1)
  })

  // The toggle is icon-only, so without an accessible name a screen reader just
  // announces "button" with no clue it opens the loudness explanation.
  it('gives the icon-only help toggle an accessible name', async () => {
    seedLoudness(healthy)
    renderEditor({ id: 'a' }, 'wav', { showLoudness: true, editorSections: NORMALIZE_OPEN })
    expect(await screen.findByTestId('loudness-help-toggle')).toHaveAccessibleName()
  })
})

// A second user asked to read the post-conversion figures next to the measured ones,
// instead of switching to the Normalize section to see where the track lands. The
// estimate is the same prediction that section draws, so the two cannot disagree.
// The table lives in Quality, where it always was, whether Normalize is open, folded or
// hidden from the layout, and it is drawn once: the same figures twice would only be noise.
describe('Editor loudness readout placement', () => {
  const measured: LoudnessResult = {
    integratedLufs: -11.1,
    truePeakDb: -0.4,
    lra: 3.8,
    channelBalanceDb: 0.1,
    dcOffset: 0.004,
    crestDb: 10.2,
    noiseFloorDb: -58.3,
  }

  beforeEach(() => {
    ;(window as unknown as { api: { loudness: unknown } }).api.loudness = vi
      .fn()
      .mockResolvedValue(measured)
  })

  it('shows the table once, in Quality, with Normalize open beside it', async () => {
    renderEditor({ id: 'a' }, 'wav', {
      showLoudness: true,
      editorSections: [
        { id: 'form', open: true },
        { id: 'quality', open: true },
        { id: 'normalize', open: true },
      ],
    })
    const readout = await screen.findByTestId('loudness-readout')
    expect(screen.getByTestId('editor-normalize')).not.toContainElement(readout)
    expect(screen.getAllByTestId('loudness-readout')).toHaveLength(1)
  })

  it('keeps the table in Quality when Normalize is hidden from the editor', async () => {
    renderEditor({ id: 'a' }, 'wav', {
      showLoudness: true,
      editorSections: [
        { id: 'form', open: true },
        { id: 'quality', open: true },
        { id: 'normalize', open: true, hidden: true },
      ],
    })
    expect(await screen.findByTestId('loudness-readout')).toBeInTheDocument()
    expect(screen.queryByTestId('editor-normalize')).not.toBeInTheDocument()
  })
})

describe('Editor loudness estimates', () => {
  const measured: LoudnessResult = {
    integratedLufs: -11.1,
    truePeakDb: -0.4,
    lra: 3.8,
    channelBalanceDb: 0.1,
    dcOffset: 0.004,
    crestDb: 10.2,
    noiseFloorDb: -58.3,
  }

  function seedLoudness(value: LoudnessResult): void {
    ;(window as unknown as { api: { loudness: unknown } }).api.loudness = vi
      .fn()
      .mockResolvedValue(value)
  }

  const club: NormalizeConfig = {
    mode: 'loudness',
    targetLufs: -9,
    truePeakDb: -1,
    peakDb: -1,
  }

  // Normalization off means nothing is going to change, so an "estimated" column would
  // just repeat the measurement in every row.
  it('shows no estimate while normalization is off', async () => {
    seedLoudness(measured)
    renderEditor({ id: 'a' }, 'wav', {
      showLoudness: true,
      editorSections: NORMALIZE_OPEN,
      normalize: { ...club, mode: 'none' },
    })
    await screen.findByTestId('loudness-pill-lufs')
    expect(screen.queryByTestId('loudness-estimate-lufs')).toBeNull()
    expect(screen.queryByTestId('loudness-estimate-range')).toBeNull()
  })

  // The loudness lands on the target and the peak is pulled to the ceiling: this track
  // needs +2.1 dB, which would push its -0.4 dBTP peak over the -1 ceiling.
  it('estimates the loudness and peak the conversion will land on', async () => {
    seedLoudness(measured)
    renderEditor({ id: 'a' }, 'wav', {
      showLoudness: true,
      editorSections: NORMALIZE_OPEN,
      normalize: club,
    })
    expect(await screen.findByTestId('loudness-estimate-lufs')).toHaveTextContent('-9.0')
    expect(screen.getByTestId('loudness-estimate-peak')).toHaveTextContent('-1.0')
  })

  // The heart of the request, and where it was wrong: the reporter expected dynamics to
  // move when the peak does. A target reachable with a CONSTANT gain moves peak and RMS
  // together, and Surco has no compressor, so their difference cannot change. Printing a
  // shifted figure there would be a number the converted file contradicts.
  it('marks the gain-invariant figures as unchanged instead of inventing a shift', async () => {
    seedLoudness(measured)
    renderEditor({ id: 'a' }, 'wav', {
      showLoudness: true,
      editorSections: NORMALIZE_OPEN,
      normalize: { ...club, targetLufs: -12 },
    })
    await screen.findByTestId('loudness-estimate-lufs')
    for (const id of ['range', 'balance']) {
      expect(screen.getByTestId(`loudness-estimate-${id}`)).toHaveTextContent(
        i18n.t('editor.loudnessEstimateSame'),
      )
    }
  })

  // The one case where the reasoning above breaks: per-channel peak normalization sizes
  // a SEPARATE gain for left and right, which is the entire point of the checkbox, so the
  // distance between them does move. A reporter measured it going from 0.8 dB to 0.3 dB
  // while the row still read "no change" — the app contradicting its own output. No
  // estimate is honest here (the shift depends on each channel's peak), so the row must
  // simply not claim the figure stays put.
  it('does not claim the balance is unchanged when the channels are normalized apart', async () => {
    seedLoudness(measured)
    renderEditor({ id: 'a' }, 'wav', {
      showLoudness: true,
      editorSections: NORMALIZE_OPEN,
      normalize: { ...club, mode: 'peak', peakDb: 0, peakPerChannel: true },
    })
    await screen.findByTestId('loudness-estimate-lufs')
    expect(screen.queryByTestId('loudness-estimate-balance')).toBeNull()
  })

  // The flag persists in settings across modes, so a user who once normalized per channel
  // in peak mode carries peakPerChannel: true into loudness mode — where it does nothing.
  // Dropping the estimate there would hide a figure that genuinely cannot move.
  it('keeps the balance estimate in loudness mode even with the per-channel flag set', async () => {
    seedLoudness(measured)
    renderEditor({ id: 'a' }, 'wav', {
      showLoudness: true,
      editorSections: NORMALIZE_OPEN,
      normalize: { ...club, targetLufs: -12, peakPerChannel: true },
    })
    await screen.findByTestId('loudness-estimate-lufs')
    expect(screen.getByTestId('loudness-estimate-balance')).toHaveTextContent(
      i18n.t('editor.loudnessEstimateSame'),
    )
  })

  // The same track normalized as one stereo pair keeps the promise: a single factor
  // scales both channels, so their difference genuinely cannot move.
  it('still marks the balance unchanged when both channels take the same gain', async () => {
    seedLoudness(measured)
    renderEditor({ id: 'a' }, 'wav', {
      showLoudness: true,
      editorSections: NORMALIZE_OPEN,
      normalize: { ...club, mode: 'peak', peakDb: 0, peakPerChannel: false },
    })
    await screen.findByTestId('loudness-estimate-lufs')
    expect(screen.getByTestId('loudness-estimate-balance')).toHaveTextContent(
      i18n.t('editor.loudnessEstimateSame'),
    )
  })

  // Removing the DC offset centres the signal, so the estimate is zero — but only when
  // the box is actually ticked, since the mode alone doesn't touch it.
  it('estimates a centred signal only when DC removal is on', async () => {
    seedLoudness(measured)
    renderEditor({ id: 'a' }, 'wav', {
      showLoudness: true,
      editorSections: NORMALIZE_OPEN,
      normalize: { ...club, removeDcOffset: true },
    })
    expect(await screen.findByTestId('loudness-estimate-dc')).toHaveTextContent('0.0%')
  })

  // With removal off the offset rides the gain; this track limits, so the gain is no
  // longer one figure and the row claims nothing rather than a wrong "=".
  it('offers no DC estimate when removal is off and the limiter engages', async () => {
    seedLoudness(measured)
    renderEditor({ id: 'a' }, 'wav', {
      showLoudness: true,
      editorSections: NORMALIZE_OPEN,
      normalize: club,
    })
    await screen.findByTestId('loudness-estimate-lufs')
    expect(screen.queryByTestId('loudness-estimate-dc')).toBeNull()
  })

  // The floor rides the gain, but only while the gain is a single constant. This track
  // limits (+2.1 dB over a -0.4 peak), so the loud passages are held back while quiet
  // ones take the full gain and no single figure describes the floor's shift.
  it('drops the noise floor estimate when the limiter engages', async () => {
    seedLoudness(measured)
    renderEditor({ id: 'a' }, 'wav', {
      showLoudness: true,
      editorSections: NORMALIZE_OPEN,
      normalize: club,
    })
    await screen.findByTestId('loudness-estimate-lufs')
    expect(screen.queryByTestId('loudness-estimate-noise')).toBeNull()
  })

  // The estimate shares a cell with the measured figure and the label. Repeating the unit
  // on both ("-11.1 LUFS  -9.0 LUFS") overflowed the widest label and the app rendered
  // "Loudn…" — the same truncation a user had already reported in the Normalize header.
  // The measured figure beside it carries the unit, so the estimate goes without.
  it('leaves the unit to the measured figure so the widest label still fits', async () => {
    seedLoudness(measured)
    renderEditor({ id: 'a' }, 'wav', {
      showLoudness: true,
      editorSections: NORMALIZE_OPEN,
      normalize: club,
    })
    const estimate = await screen.findByTestId('loudness-estimate-lufs')
    expect(estimate.textContent).toBe('→ -9.0')
    expect(estimate.textContent).not.toMatch(/LUFS/)
  })

  // With headroom to spare the gain is constant all the way down, so the floor rises
  // with it: -58.3 dB + 6 dB of gain (-20 LUFS up to the -14 target).
  it('raises the noise floor by the gain when nothing is limited', async () => {
    seedLoudness({ ...measured, integratedLufs: -20, truePeakDb: -12 })
    renderEditor({ id: 'a' }, 'wav', {
      showLoudness: true,
      editorSections: NORMALIZE_OPEN,
      normalize: { ...club, targetLufs: -14 },
    })
    expect(await screen.findByTestId('loudness-estimate-noise')).toHaveTextContent('-52.3')
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
        readFullTrack={async () => undefined}
        filesOpen
        resultsFolded={false}
        onFoldResults={vi.fn()}
        onResultsResizeStart={vi.fn()}
        onResultsFit={vi.fn()}
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
        onShowLoudnessHelp={vi.fn()}
        onHideEditorHints={vi.fn()}
        onOpenRename={vi.fn()}
        onRegenerateName={vi.fn()}
        onTrimDetectedAll={vi.fn()}
        onCopyFilename={vi.fn()}
        onCopyPath={vi.fn()}
        onSearchWeb={vi.fn()}
        onCopyMeta={vi.fn()}
        onPasteMeta={vi.fn()}
        copiedMetaTitle={null}
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

  // Plex reads "Hard Dance, Techno" as one genre and splits on ";", so a user who tags for
  // Plex picks ";" and every chip has to add with it.
  it('adds a genre with the separator chosen in settings', () => {
    const { onChange } = renderEditor({ id: 'a', meta: { genre: 'Hard Dance' } }, 'wav', {
      visibleFields: ['genre'],
      genrePresets: ['Hard Dance', 'Techno'],
      genreSeparator: '; ',
    })
    fireEvent.click(screen.getByTestId('chip-Techno'))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ genre: 'Hard Dance; Techno' }) }),
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
    expect(await hoverForTooltip(badge)).toHaveTextContent(i18n.t('editor.matchSuggested'))
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
  it('probes the tempo as soon as the track opens, without a fixed wait', async () => {
    const bpm = vi.fn().mockResolvedValue({ bpm: 124, confidence: 0.8 })
    ;(window as unknown as { api: { bpm: unknown } }).api.bpm = bpm
    renderEditor({ id: 'a' }, 'wav', { visibleFields: ['bpm'] })
    await vi.waitFor(() => expect(bpm).toHaveBeenCalledTimes(1), { timeout: 150 })
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

  it('offers a tempo already detected on disk before its live probe answers', async () => {
    const api = window as unknown as { api: { bpm: unknown; peekAnalysis: unknown } }
    api.api.bpm = vi.fn(() => new Promise(() => {}))
    api.api.peekAnalysis = vi.fn(async (family: string) =>
      family === 'bpm' ? { bpm: 128, confidence: 0.9 } : null,
    )
    renderEditor({ id: 'a' }, 'wav', { visibleFields: ['bpm'] })
    expect(await screen.findByTestId('chip-128')).toBeInTheDocument()
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
  it('offers a key already detected on disk before its live probe answers', async () => {
    const api = window as unknown as { api: { key: unknown; peekAnalysis: unknown } }
    api.api.key = vi.fn(() => new Promise(() => {}))
    api.api.peekAnalysis = vi.fn(async (family: string) =>
      family === 'key' ? { camelot: '5A', name: 'Cm', confidence: 0.8 } : null,
    )
    renderEditor({ id: 'a' }, 'wav', { visibleFields: ['key'] })
    expect(await screen.findByTestId('chip-5A')).toBeInTheDocument()
  })

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

describe('Editor multi-select bulk actions', () => {
  // The header already reads "Editing 2 tracks", so a button that counts them again only
  // repeats the number a line above it.
  it('names the bulk rename and trim without repeating the selection count', () => {
    renderWithQuery(<MultiHarness />, { visibleFields: ['title'] })
    expect(screen.getByTestId('regenerate-output-names-all')).toHaveTextContent(
      'Regenerate file names from metadata',
    )
    expect(screen.getByTestId('trim-detect-all')).toHaveTextContent(
      'Trim detected silence on every track',
    )
  })
})

const rekordboxTree = [{ id: '3000', name: 'Makina', kind: 'playlist' as const, count: 1 }]

function rekordboxApiWith(membership: ProgramReads['membership']): void {
  Object.assign(window.api, {
    dj: djReads({
      rekordbox: {
        available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
        tree: vi.fn<ProgramReads['tree']>().mockResolvedValue(rekordboxTree),
        membership: membership,
      },
    }),
  })
}

describe('Editor multi-select', () => {
  function renderMulti(
    opts: {
      done?: boolean
      platform?: string
      music?: boolean
      loudness?: boolean
      visibleFields?: string[]
      requiredFields?: string[]
      metaA?: Partial<TrackMetadata>
      metaB?: Partial<TrackMetadata>
      normalizeA?: NormalizeConfig
      normalizeB?: NormalizeConfig
      declickA?: DeclickConfig
      declickB?: DeclickConfig
      groupingPresets?: string[]
      groupingSeparator?: string
      customFields?: Settings['customFields']
      rekordboxCue?: React.ComponentProps<typeof Editor>['rekordboxCue']
      onCueAutoMarkAll?: () => void
      onCuePhrasesAll?: () => Promise<{ done: number; skipped: number; comments: PhrasedComment[] }>
      cueTargets?: React.ComponentProps<typeof Editor>['cueTargets']
      fromSeratoA?: boolean
      replacesA?: string
      durationA?: number
      libraryIndex?: AppleMusicIndex | null
      fileA?: string
      fileB?: string
      settings?: Partial<Settings>
      onChangeSelection?: (patch: Partial<TrackItem>) => void
      onFormatChange?: (format: FormatSetting | null) => void
      onApplyTitleFormat?: () => void
    } = {},
  ) {
    if (opts.platform)
      (window as unknown as { api: { platform: string } }).api.platform = opts.platform
    const onChangeAllMeta = vi.fn()
    const onClearAll = vi.fn()
    const onProcessAll = vi.fn()
    const onAddAllToAppleMusic = vi.fn()
    const onDeriveTags = vi.fn()
    const onChangeTracksMeta = vi.fn()
    const onNumberTracks = vi.fn()
    const onChangeTracksPlaylists = vi.fn()
    const status = opts.done ? ('done' as const) : ('idle' as const)
    const build = (over: Partial<typeof opts> = {}) => {
      const o = { ...opts, ...over }
      const a = item({
        id: 'a',
        fileName: 'kumara - one.flac',
        ...(o.fileA && { inputPath: o.fileA }),
        status,
        outputPath: o.done ? '/out/a.aiff' : undefined,
        meta: { title: 'A', album: 'Shared', ...o.metaA },
        ...(o.normalizeA && { normalize: o.normalizeA }),
        ...(o.declickA && { declick: o.declickA }),
        spectrum: { cutoffHz: null, sampleRateHz: 44100, processed: false },
        ...(o.fromSeratoA && { programs: ['serato'] }),
        ...(o.replacesA && { replacesPath: o.replacesA }),
        ...(o.durationA && { duration: o.durationA }),
      })
      const b = item({
        id: 'b',
        fileName: 'cortina - two.flac',
        ...(o.fileB && { inputPath: o.fileB }),
        status,
        outputPath: o.done ? '/out/b.aiff' : undefined,
        meta: { title: 'B', album: 'Shared', ...o.metaB },
        ...(o.normalizeB && { normalize: o.normalizeB }),
        ...(o.declickB && { declick: o.declickB }),
      })
      return (
        <Editor
          item={a}
          libraryIndex={o.libraryIndex ?? null}
          rekordboxCue={o.rekordboxCue}
          onCueAutoMarkAll={o.onCueAutoMarkAll}
          onCuePhrasesAll={o.onCuePhrasesAll}
          cueTargets={o.cueTargets}
          searchInputRef={createRef<HTMLInputElement>()}
          onExportCollection={vi.fn()}
          readFullTrack={async () => undefined}
          filesOpen
          resultsFolded={false}
          onFoldResults={vi.fn()}
          onResultsResizeStart={vi.fn()}
          onResultsFit={vi.fn()}
          selectedTracks={[a, b]}
          onNumberTracks={onNumberTracks}
          onChangeSelection={o.onChangeSelection}
          onFormatChange={o.onFormatChange}
          onApplyTitleFormat={o.onApplyTitleFormat}
          onApplyMatches={vi.fn()}
          onProcessAll={onProcessAll}
          onAddAllToAppleMusic={onAddAllToAppleMusic}
          onChangeAllMeta={onChangeAllMeta}
          onClearAll={onClearAll}
          onApplyCoverAll={vi.fn()}
          onDeriveTags={onDeriveTags}
          onChangeTracksMeta={onChangeTracksMeta}
          onChangeTracksPlaylists={onChangeTracksPlaylists}
          onChange={vi.fn()}
          onProcess={vi.fn()}
          onAddToAppleMusic={vi.fn()}
          onShowLoudnessHelp={vi.fn()}
          onHideEditorHints={vi.fn()}
          onOpenRename={vi.fn()}
          onRegenerateName={vi.fn()}
          onTrimDetectedAll={vi.fn()}
          onCopyFilename={vi.fn()}
          onCopyPath={vi.fn()}
          onSearchWeb={vi.fn()}
          onCopyMeta={vi.fn()}
          onPasteMeta={vi.fn()}
          copiedMetaTitle={null}
        />
      )
    }
    const rendered = renderWithQuery(build(), {
      addToAppleMusic: opts.music ?? false,
      groupingPresets: opts.groupingPresets ?? [],
      ...(opts.groupingSeparator ? { groupingSeparator: opts.groupingSeparator } : {}),
      customFields: opts.customFields ?? [],
      visibleFields: opts.visibleFields ?? ['title', 'album'],
      requiredFields: opts.requiredFields ?? ['title'],
      showSpectrum: true,
      showLoudness: opts.loudness ?? false,
      ...opts.settings,
    })
    return {
      onChangeAllMeta,
      onClearAll,
      onProcessAll,
      onAddAllToAppleMusic,
      onDeriveTags,
      onChangeTracksMeta,
      onNumberTracks,
      onChangeTracksPlaylists,
      rerenderTracks: (over: Partial<typeof opts>) => rendered.rerenderUi(build(over)),
    }
  }

  // A selection converted again replaces the files its tracks replaced before: when Serato
  // holds one, the DJ must read that its stars go before pressing, as with a single track.
  it('warns that Serato loses the stars when a selected track replaces a file Serato holds', async () => {
    Object.assign(window.api, {
      dj: djReads({
        serato: {
          collection: vi
            .fn<ProgramReads['collection']>()
            .mockResolvedValue([{ contentId: '1', path: '/s/old.wav', title: 'A', artist: '' }]),
        },
      }),
    })
    renderMulti({ replacesA: '/s/old.wav', settings: { syncSerato: true } })
    expect(await screen.findByTestId('convert-serato-stars-note')).toBeInTheDocument()
  })

  // The 23/11 replacement test: the same track stamped to replace a file Serato holds warned
  // when selected with another and stayed silent alone, as the single path only asked the
  // library lookup. One track and several warn about the same file the convert replaces.
  it('warns that Serato loses the stars when a single track replaces a file Serato holds', async () => {
    Object.assign(window.api, {
      dj: djReads({
        serato: {
          collection: vi
            .fn<ProgramReads['collection']>()
            .mockResolvedValue([{ contentId: '1', path: '/s/old.wav', title: 'A', artist: '' }]),
        },
      }),
    })
    renderEditor({ id: 'a', replacesPath: '/s/old.wav' }, 'wav', { syncSerato: true })
    expect(await screen.findByTestId('convert-serato-stars-note')).toBeInTheDocument()
  })

  // Working out what a convert would leave out walks every selected track through the
  // library and required-field checks. Typing a search in the results column changes none
  // of that, so a big selection must not pay for it on every keystroke.
  it('keeps the convert plan of several tracks while typing a search', () => {
    renderMulti()
    const before = vi.mocked(convertGate).mock.calls.length
    for (const query of ['k', 'ku', 'kum']) {
      fireEvent.change(screen.getByTestId('discogs-query'), { target: { value: query } })
    }
    expect(screen.getByTestId('discogs-query')).toHaveValue('kum')
    expect(vi.mocked(convertGate).mock.calls.length - before).toBe(0)
  })

  // "File" heads the single-track form; over "Editing 2 tracks" it read as one file
  // sitting above a selection of several, so the multi form starts at its own title.
  it('drops the File heading above the multi-select form', () => {
    renderMulti()
    expect(screen.queryByTestId('editor-group-metadata')).toBeNull()
  })

  // The rating is a field of the form like any other: a selection of several tracks used to
  // leave it out, so rating a crate meant opening every track one by one.
  it('rates every selected track from the stars of the multi form', () => {
    const { onChangeAllMeta } = renderMulti({ metaA: { rating: '2' }, metaB: { rating: '2' } })
    expect(screen.getByTestId('star-2')).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByTestId('star-4'))
    expect(onChangeAllMeta).toHaveBeenCalledWith({ rating: '4' })
  })

  // Showing the first track's stars over a selection would claim all of them carry it.
  it('shows the stars empty when the selected tracks rate differently', () => {
    renderMulti({ metaA: { rating: '2' }, metaB: { rating: '5' } })
    for (const n of [1, 2, 3, 4, 5]) {
      expect(screen.getByTestId(`star-${n}`)).toHaveAttribute('aria-checked', 'false')
    }
  })

  // Several files have no one folder to open, so the header offers no reveal over them.
  it('offers no reveal over several tracks', () => {
    renderMulti()
    expect(screen.queryByTestId('reveal-file-btn')).toBeNull()
  })

  // One tag set copied from several tracks, or pasted over all of them, is a bulk edit the
  // header pair was never meant to be; the multi form keeps its own field-by-field tools.
  it('offers no metadata copy or paste over several tracks', () => {
    renderMulti()
    expect(screen.queryByTestId('copy-meta-btn')).toBeNull()
    expect(screen.queryByTestId('paste-meta-btn')).toBeNull()
  })

  // Rewriting titles and pasting the copied tags are different jobs over the whole
  // selection; a line between them keeps the paste from reading as part of the title pass.
  it('draws a line between rewriting titles and pasting in the more menu', () => {
    renderMulti({ onApplyTitleFormat: vi.fn(), settings: { titleFormat: '{title}' } })
    openMore()
    const menu = screen.getByRole('menu')
    expect(within(menu).getAllByRole('separator')).toHaveLength(1)
    expect(screen.getByTestId('paste-meta-btn').previousElementSibling).toBe(
      within(menu).getByRole('separator'),
    )
  })

  // With no title format the paste is the menu's only item; a line over it would
  // separate it from nothing.
  it('draws no line over the paste when it is alone in the more menu', () => {
    renderMulti()
    openMore()
    expect(screen.getByTestId('paste-meta-btn')).toBeInTheDocument()
    expect(within(screen.getByRole('menu')).queryAllByRole('separator')).toHaveLength(0)
  })

  it('completes a playlist only some of the tracks hold into per-track patches for all of them', async () => {
    rekordboxApiWith(
      vi.fn<ProgramReads['membership']>().mockResolvedValue({ '/music/a.wav': ['3000'] }),
    )
    const { onChangeTracksPlaylists } = renderMulti({ visibleFields: ['rekordboxPlaylists'] })
    fireEvent.click(await screen.findByTestId('playlists-summary'))
    fireEvent.click(screen.getByTestId('playlists-check-3000'))
    expect(onChangeTracksPlaylists).toHaveBeenCalledWith([
      {
        id: 'a',
        playlists: { rekordbox: { targets: [{ id: '3000', name: 'Makina' }], base: ['3000'] } },
      },
      {
        id: 'b',
        playlists: { rekordbox: { targets: [{ id: '3000', name: 'Makina' }], base: [] } },
      },
    ])
  })

  // A selected track whose rekordbox collection holds an entry of the same title, artist and
  // length is filed there at once; the other one is staged for its conversion as before.
  it('adds the rekordbox copy of a selected track to a playlist at once and stages the other', async () => {
    const editPlaylist = vi.fn<ProgramReads['editPlaylist']>().mockResolvedValue({ applied: true })
    Object.assign(window.api, {
      dj: djReads({
        rekordbox: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi.fn<ProgramReads['tree']>().mockResolvedValue(rekordboxTree),
          membership: vi
            .fn<ProgramReads['membership']>()
            .mockResolvedValue({ '/r/a.aiff': [], '/music/b.wav': [] }),
          collection: async () => [
            { contentId: 'r1', path: '/r/a.aiff', title: 'A', artist: 'Kumara', durationSec: 361 },
          ],
          editPlaylist,
        },
      }),
    })
    const { onChangeTracksPlaylists } = renderMulti({
      visibleFields: ['rekordboxPlaylists'],
      metaA: { artist: 'Kumara' },
      durationA: 361,
      settings: { syncRekordbox: true },
    })
    await waitFor(() =>
      expect(window.api.dj.membership).toHaveBeenCalledWith('rekordbox', [
        '/music/b.wav',
        '/r/a.aiff',
      ]),
    )
    fireEvent.click(await screen.findByTestId('playlists-summary'))
    fireEvent.click(screen.getByTestId('playlists-check-3000'))
    await waitFor(() =>
      expect(editPlaylist).toHaveBeenCalledWith(
        { kind: 'add', playlistId: '3000', tracks: [{ paths: ['/r/a.aiff'] }] },
        'Makina',
      ),
    )
    expect(onChangeTracksPlaylists).toHaveBeenCalledWith([
      {
        id: 'b',
        playlists: { rekordbox: { targets: [{ id: '3000', name: 'Makina' }], base: [] } },
      },
    ])
  })

  // WHY: with two tracks selected, a grouping chip used to write the same value to
  // both through onChangeAllMeta, erasing each one's own tags. A vocal cut and a beat
  // on the same release need different grouping, so the per-track row writes only its
  // own track.
  it('writes a grouping chip picked on one track row to that track alone', () => {
    const { onChangeTracksMeta, onChangeAllMeta } = renderMulti({
      visibleFields: ['grouping'],
      groupingPresets: ['Bases', 'Vocals'],
      metaA: { grouping: 'Bases' },
    })
    fireEvent.click(screen.getByTestId('grouping-per-track-toggle'))
    fireEvent.click(screen.getByTestId('chip-b-Vocals'))
    expect(onChangeTracksMeta).toHaveBeenCalledWith([{ id: 'b', meta: { grouping: 'Vocals' } }])
    expect(onChangeAllMeta).not.toHaveBeenCalled()
  })

  // Total discs describes the release as much as the disc number does, so a selection
  // from one record shows both and they keep the shared row of the single form.
  it('shows total discs beside the disc number across a selection', () => {
    renderMulti({ visibleFields: ['discNumber', 'discTotal'] })
    expect(screen.getByTestId('field-column-discNumber').parentElement).toContainElement(
      screen.getByTestId('field-column-discTotal'),
    )
  })

  it('adds a grouping tag on a track row with the separator chosen in settings', () => {
    const { onChangeTracksMeta } = renderMulti({
      visibleFields: ['grouping'],
      groupingPresets: ['Bases', 'Vocals'],
      groupingSeparator: '/',
      metaB: { grouping: 'Bases' },
    })
    fireEvent.click(screen.getByTestId('grouping-per-track-toggle'))
    fireEvent.click(screen.getByTestId('chip-b-Vocals'))
    expect(onChangeTracksMeta).toHaveBeenCalledWith([
      { id: 'b', meta: { grouping: 'Bases/Vocals' } },
    ])
  })

  // A custom field edited across a selection lands in every selected track, each through
  // its own custom set rather than one shared value stamped over all the tracks' fields.
  it('writes a custom field edited across the selection into every track', () => {
    const { onChangeTracksMeta, onChangeAllMeta } = renderMulti({
      visibleFields: ['vinylCondition'],
      customFields: [{ key: 'vinylCondition', label: 'Estado del vinilo' }],
      metaA: { custom: { vinylCondition: 'NM' } },
    })
    const field = screen.getByTestId('field-vinylCondition')
    fireEvent.change(field, { target: { value: 'VG+' } })
    fireEvent.blur(field)
    expect(onChangeTracksMeta).toHaveBeenCalledWith(
      [
        { id: 'a', meta: { custom: { vinylCondition: 'VG+' } } },
        { id: 'b', meta: { custom: { vinylCondition: 'VG+' } } },
      ],
      expect.objectContaining({ group: expect.any(String) }),
    )
    expect(onChangeAllMeta).not.toHaveBeenCalled()
  })

  // The spectrum and output filename describe a single file; over a multi-selection they
  // are meaningless, so they must not show the primary track's by accident.
  it('hides the per-track spectrum and filename when several tracks are selected', () => {
    renderMulti()
    expect(screen.queryByTestId('quality-status')).toBeNull()
    expect(screen.queryByTestId('properties-summary')).toBeNull()
    expect(screen.queryByTestId('output-name')).toBeNull()
  })

  // A Shift+click used to pull Quality and Properties out of the column, jumping every
  // section below them up the editor. They stay in place, folded and off, saying why.
  it.each([
    ['quality', 'editor.qualityTitle'],
    ['properties', 'editor.propertiesTitle'],
  ])('keeps the %s header in place, folded and disabled, over several tracks', (id, title) => {
    renderMulti()
    const section = screen.getByTestId(`${id}-single-only`)
    const header = within(section).getByRole('button', { name: i18n.t(title) })
    expect(header).toBeDisabled()
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(section).toHaveTextContent(i18n.t('editor.singleTrackOnly'))
  })

  it('keeps the cues header in place, folded and disabled, over several tracks of a rekordbox playlist', () => {
    renderMulti({ rekordboxCue: { contentId: '103', path: '/music/a.wav', label: 'a' } })
    const section = screen.getByTestId('cues-single-only')
    const header = within(section).getByRole('button', { name: i18n.t('editor.cues.title') })
    expect(header).toBeDisabled()
    expect(section).toHaveTextContent(i18n.t('editor.singleTrackOnly'))
  })

  it('offers Auto marcar for the whole selection in the cues slot, so a playlist is prepared at once', () => {
    const onCueAutoMarkAll = vi.fn()
    renderMulti({
      rekordboxCue: { contentId: '103', path: '/music/a.wav', label: 'a' },
      onCueAutoMarkAll,
      onCuePhrasesAll: vi.fn(async () => ({ done: 0, skipped: 0, comments: [] })),
      cueTargets: [
        { contentId: '103', path: '/music/a.wav', label: 'a' },
        { contentId: '104', path: '/music/b.wav', label: 'b' },
      ],
    })
    expect(screen.queryByTestId('cues-single-only')).toBeNull()
    const button = within(screen.getByTestId('cues-multi')).getByTestId('cues-auto-mark-all')
    expect(button).toHaveTextContent(i18n.t('editor.cues.batch.mark', { count: 2 }))
    fireEvent.click(button)
    expect(onCueAutoMarkAll).toHaveBeenCalledTimes(1)
  })

  it('puts the phrases in the comments of the whole selection from the cues slot', () => {
    const onCuePhrasesAll = vi.fn(async () => ({ done: 2, skipped: 0, comments: [] }))
    renderMulti({
      rekordboxCue: { contentId: '103', path: '/music/a.wav', label: 'a' },
      onCueAutoMarkAll: vi.fn(),
      onCuePhrasesAll,
      cueTargets: [
        { contentId: '103', path: '/music/a.wav', label: 'a' },
        { contentId: '104', path: '/music/b.wav', label: 'b' },
      ],
    })
    fireEvent.click(within(screen.getByTestId('cues-multi')).getByTestId('cues-batch-phrases'))
    expect(onCuePhrasesAll).toHaveBeenCalledTimes(1)
  })

  it('shows no cues section over several tracks outside a rekordbox playlist', () => {
    renderMulti()
    expect(screen.queryByTestId('cues-single-only')).toBeNull()
    expect(screen.queryByTestId('cues-section')).toBeNull()
  })

  // A disabled header refuses focus, so ⌘] aimed at one left focus where it was and every
  // further press aimed at it again: the jump stuck above Properties.
  it('jumps over the disabled headers to the next live section', () => {
    renderMulti()
    screen.getByTestId('field-album').focus()
    act(() => {
      runKeyClaim('section-next')
    })
    const landed = (document.activeElement as HTMLElement).dataset.sectionHeader
    expect(landed).toBe('declick')
  })

  // One track and a selection drew two different footers for one job; a selection now
  // converts from the same split button, the chosen format on its dropdown half.
  it('converts a selection from the same split button as one track', () => {
    renderMulti({ fileA: '/music/a.flac', fileB: '/music/b.flac' })
    expect(screen.getByTestId('field-album')).toHaveValue('Shared')
    expect(screen.getByTestId('field-title')).toHaveAttribute('readonly')
    expect(screen.getByTestId('process-btn')).toHaveTextContent(
      i18n.t('header.convertSelected', { count: 2 }),
    )
    expect(screen.getByTestId('process-format-current')).toHaveTextContent('AIFF')
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    expect(screen.getByRole('menu')).toHaveTextContent(i18n.t('editor.menuFormat'))
    expect(screen.getByRole('menu')).toHaveTextContent(i18n.t('editor.menuDestination'))
    expect(screen.getByTestId('process-format-aiff')).toHaveAttribute('aria-checked', 'true')
  })

  // Over two FLACs "Same as source" is FLAC under a second name; over a mix it is the one
  // choice that keeps each file in its own format.
  it('offers Same as source only over files of more than one format', () => {
    const { rerenderTracks } = renderMulti({ fileA: '/music/a.flac', fileB: '/music/b.flac' })
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    expect(screen.queryByTestId('process-format-source')).toBeNull()
    rerenderTracks({ fileA: '/music/a.flac', fileB: '/music/b.mp3' })
    expect(screen.getByTestId('process-format-source')).toBeInTheDocument()
  })

  // AIFF is what Settings say, but the keep setting leaves the MP3 as MP3: the dropdown
  // shows the pick, so the button has to say the run writes both.
  it('does not promise a single format when a kept MP3 stays MP3 beside a FLAC', () => {
    renderMulti({
      fileA: '/music/a.mp3',
      fileB: '/music/b.flac',
      settings: { outputFormat: 'aiff', keepMp3Sources: true },
    })
    expect(screen.getByTestId('process-btn')).toHaveTextContent(
      i18n.t('header.convertSelected', { count: 2 }),
    )
    expect(hoverTooltip(screen.getByTestId('process-btn'))).toContain('MP3')
  })

  it('picks the batch format from the menu and marks it as the one in use', () => {
    renderMulti({ fileA: '/music/a.flac', fileB: '/music/b.flac' })
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.click(screen.getByTestId('process-format-wav'))
    expect(screen.getByTestId('process-format-current')).toHaveTextContent('WAV')
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    expect(screen.getByTestId('process-format-wav')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('process-format-aiff')).toHaveAttribute('aria-checked', 'false')
  })

  // The footer said "Convert" over MP3s that the keep setting leaves as MP3: with AIFF only
  // the Settings default, the run rewrites their tags and nothing else.
  it('says it updates when the default format leaves every selected MP3 as it is', () => {
    renderMulti({
      fileA: '/music/a.mp3',
      fileB: '/music/b.mp3',
      settings: { outputFormat: 'aiff', keepMp3Sources: true, overwriteOriginal: true },
    })
    expect(screen.getByTestId('process-btn')).toHaveTextContent(
      i18n.t('header.updateSelected', { count: 2 }),
    )
  })

  it('picks the batch destination from the menu and marks it as the one in use', () => {
    renderMulti()
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.click(screen.getByTestId('process-destination-beside'))
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    expect(screen.getByTestId('process-destination-beside')).toHaveAttribute('aria-checked', 'true')
  })

  it('says it converts those MP3s once another format is picked by hand', () => {
    renderMulti({
      fileA: '/music/a.mp3',
      fileB: '/music/b.mp3',
      settings: { outputFormat: 'aiff', keepMp3Sources: true, overwriteOriginal: true },
    })
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.click(screen.getByTestId('process-format-wav'))
    expect(screen.getByTestId('process-btn')).toHaveTextContent(
      i18n.t('header.convertSelected', { count: 2 }),
    )
  })

  // The destination came from the open track: with a FLAC open it read "Output folder"
  // while the batch sent the other tracks to Apple Music, where Settings point.
  it('shows where Settings send the batch, not where the open track would go', () => {
    renderMulti({
      platform: 'darwin',
      fileA: '/music/a.flac',
      fileB: '/music/b.wav',
      settings: { outputFormat: 'source', addToAppleMusic: true },
    })
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    expect(screen.getByTestId('process-destination-appleMusic')).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  // With nothing ready the button was a greyed "Convert 0 of 2" that did nothing; one track
  // in the same spot names what is missing and a press takes the DJ to the field.
  it('wears the blocked face of one track when nothing is ready, and a press focuses the missing field', () => {
    renderMulti({ requiredFields: ['artist'], visibleFields: ['title', 'album', 'artist'] })
    expect(screen.getByTestId('process-blocked-face')).toHaveTextContent(
      i18n.t('editor.missingOne', { field: i18n.t('fields.artist') }),
    )
    fireEvent.click(screen.getByTestId('process-btn'))
    expect(document.activeElement).toBe(screen.getByTestId('field-artist'))
  })

  // The section says it applies to every selected track, but only the open one took the
  // level: the rest converted with whatever they had.
  it('gives the click repair picked over a selection to every selected track', () => {
    const onChangeSelection = vi.fn()
    renderMulti({
      onChangeSelection,
      settings: { editorSections: [{ id: 'declick' as const, open: true }] },
    })
    fireEvent.click(screen.getByTestId('declick-mode-standard'))
    expect(onChangeSelection).toHaveBeenCalledWith({
      declick: expect.objectContaining({ mode: 'standard' }),
    })
  })

  // The dials show the anchor track's value, but each track converts with its own: a header
  // that read like one setting would promise loudness the other tracks will not get.
  describe('loudness and click settings that differ across the selection', () => {
    const club = { mode: 'loudness' as const, targetLufs: -14, truePeakDb: -1, peakDb: -1 }
    const folded = (id: 'normalize' | 'declick') => ({
      editorSections: [{ id, open: false }],
    })

    it('says the tracks carry different loudness settings instead of one of them', () => {
      renderMulti({
        normalizeA: club,
        normalizeB: { ...club, targetLufs: -9 },
        settings: folded('normalize'),
      })
      expect(screen.getByTestId('normalize-row-sentence')).toHaveTextContent(
        i18n.t('normalize.row.mixed'),
      )
    })

    it('keeps the normal loudness summary when every track carries the same setting', () => {
      renderMulti({ normalizeA: club, normalizeB: { ...club }, settings: folded('normalize') })
      expect(screen.getByTestId('normalize-row-sentence')).not.toHaveTextContent(
        i18n.t('normalize.row.mixed'),
      )
    })

    it('says the tracks carry different click repair settings instead of one of them', () => {
      renderMulti({
        declickA: { mode: 'soft', noise: 'off' },
        declickB: { mode: 'strong', noise: 'off' },
        settings: folded('declick'),
      })
      expect(screen.getByTestId('declick-row-sentence')).toHaveTextContent(
        i18n.t('declick.row.mixed'),
      )
    })

    // Conversion resolves a track without its own setting to the dials on screen, so an
    // anchor with an override beside an unset track converts both the same way.
    it('does not call the loudness mixed when only the anchor has an override and the others follow the dials', () => {
      renderMulti({ normalizeA: club, settings: folded('normalize') })
      expect(screen.getByTestId('normalize-row-sentence')).not.toHaveTextContent(
        i18n.t('normalize.row.mixed'),
      )
    })

    it('does not call the click repair mixed when only the anchor has an override and the others follow the dials', () => {
      renderMulti({ declickA: { mode: 'soft', noise: 'off' }, settings: folded('declick') })
      expect(screen.getByTestId('declick-row-sentence')).not.toHaveTextContent(
        i18n.t('declick.row.mixed'),
      )
    })

    // Moving a dial writes the value into every track, so the header has to stop saying the
    // tracks differ the moment they no longer do.
    it('goes back to the loudness sentence once a dial is set for all the tracks', () => {
      const onChangeSelection = vi.fn()
      const { rerenderTracks } = renderMulti({
        normalizeA: club,
        normalizeB: { ...club, targetLufs: -9 },
        onChangeSelection,
        settings: { editorSections: [{ id: 'normalize' as const, open: true }] },
      })
      fireEvent.click(screen.getByTestId('normalize-mode-peak'))
      const staged = onChangeSelection.mock.calls[0][0].normalize
      rerenderTracks({ normalizeA: staged, normalizeB: staged })
      fireEvent.click(screen.getByRole('button', { name: i18n.t('normalize.title') }))
      expect(screen.getByTestId('normalize-row-sentence')).not.toHaveTextContent(
        i18n.t('normalize.row.mixed'),
      )
    })

    it('goes back to the click repair sentence once a mode is set for all the tracks', () => {
      const onChangeSelection = vi.fn()
      const { rerenderTracks } = renderMulti({
        declickA: { mode: 'soft', noise: 'off' },
        declickB: { mode: 'strong', noise: 'off' },
        onChangeSelection,
        settings: { editorSections: [{ id: 'declick' as const, open: true }] },
      })
      fireEvent.click(screen.getByTestId('declick-mode-standard'))
      const staged = onChangeSelection.mock.calls[0][0].declick
      rerenderTracks({ declickA: staged, declickB: staged })
      fireEvent.click(screen.getByRole('button', { name: i18n.t('declick.title') }))
      expect(screen.getByTestId('declick-row-sentence')).not.toHaveTextContent(
        i18n.t('declick.row.mixed'),
      )
    })

    it('keeps the normal click repair summary when every track carries the same setting', () => {
      renderMulti({
        declickA: { mode: 'soft', noise: 'off' },
        declickB: { mode: 'soft', noise: 'off' },
        settings: folded('declick'),
      })
      expect(screen.getByTestId('declick-row-sentence')).not.toHaveTextContent(
        i18n.t('declick.row.mixed'),
      )
    })
  })

  // "Same as source" skips a file that has no format of its own to stay in, so the button
  // must not count it among the ones it will write.
  it('leaves out of the count a file the batch will skip', () => {
    renderMulti({
      fileA: '/music/a.wav',
      fileB: '/music/b.opus',
      settings: { outputFormat: 'source', overwriteOriginal: true },
    })
    expect(screen.getByTestId('process-btn')).toHaveTextContent(
      i18n.t('header.updateSomeSelected', { ready: 1, total: 2 }),
    )
  })

  // Per-track fields keep their place so a selection reads like one track, but a title
  // typed here would land on every track, so it cannot be typed into.
  it('shows the per-track title in place and read-only', () => {
    renderMulti({ metaA: { title: 'One' }, metaB: { title: 'Two' } })
    const title = screen.getByTestId('field-title')
    expect(title).toHaveAttribute('readonly')
    expect(title).toHaveValue('')
    expect(title).toHaveAccessibleDescription(i18n.t('editor.perTrackOnly'))
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

  // The batch drops tracks with empty required fields (eligibleForBatch), and the
  // toolbar's count says so ("1 of 2"); the footer is where the selection says which
  // field is missing, so the gap is named, not only counted.
  it('names the required field a selected track is missing', () => {
    renderMulti({
      requiredFields: ['artist'],
      metaA: { artist: 'Kumara' },
    })
    expect(screen.getByTestId('batch-plan-blocked')).toBeInTheDocument()
  })

  it('names nothing once every selected track has the required fields', () => {
    renderMulti({
      requiredFields: ['artist'],
      metaA: { artist: 'Kumara' },
      metaB: { artist: 'Cortina' },
    })
    expect(screen.queryByTestId('batch-plan-blocked')).toBeNull()
  })

  // The plan reads the same gate as the header's Convert and says it in the same words,
  // so "Convert 1 of 2 selected · 1 track left out, Serato would lose it and its cues" up
  // top and the plan down here never disagree about one selection (06/11).
  it('names Serato as the reason in the batch plan when a selected track comes from Serato', () => {
    renderMulti({ fromSeratoA: true })
    expect(screen.getByTestId('batch-plan-blocked')).toHaveTextContent(
      i18n.t('header.leftOutSerato', { count: 1 }),
    )
  })

  it('names both Serato and the fields the other tracks still miss, so neither reason hides the other', () => {
    renderMulti({ fromSeratoA: true, requiredFields: ['artist'], metaA: { artist: 'Kumara' } })
    const blocked = screen.getByTestId('batch-plan-blocked')
    expect(blocked).toHaveTextContent(i18n.t('header.leftOutSerato', { count: 1 }))
    expect(blocked).toHaveTextContent(i18n.t('fields.artist'))
  })

  it('does not name a field only the Serato track misses, since that track is not converted anyway', () => {
    renderMulti({ fromSeratoA: true, requiredFields: ['artist'], metaB: { artist: 'Cortina' } })
    expect(screen.getByTestId('batch-plan-blocked')).toHaveTextContent(
      new RegExp(`^${i18n.t('header.leftOutSerato', { count: 1 })}$`),
    )
  })

  // "2 tracks → AIFF" under a header reading "Convert 1 of 2" counted the track the batch
  // skips; the plan counts what the click converts, and the amber line says what stays out.
  it('counts in the plan only the tracks the batch will convert, like the header', () => {
    renderMulti({ requiredFields: ['artist'], metaA: { artist: 'Kumara' } })
    expect(screen.getByTestId('process-btn')).toHaveTextContent(
      i18n.t('header.convertSomeSelected', { ready: 1, total: 2 }),
    )
  })

  // The one case with no honest subset: the header's Convert is held back for it, and the
  // plan says why in the same words.
  it('says the selection mixes replacing a library copy with adding, like the header', () => {
    renderMulti({
      metaA: { artist: 'Halo', title: 'Sunrise' },
      libraryIndex: buildLibraryIndex([{ title: 'Sunrise', artist: 'Halo', persistentId: 'P1' }]),
    })
    expect(screen.getByTestId('batch-plan-blocked')).toHaveTextContent(
      i18n.t('editor.mixedReplaceSelection'),
    )
    expect(screen.getByTestId('process-btn')).toHaveAttribute('aria-disabled', 'true')
  })

  // Nothing converts because the selection mixes replacing with adding, not because of the
  // empty field: the face must not send the DJ to a field that would change nothing.
  it('keeps the plain face when something other than a missing field holds every track back', () => {
    renderMulti({
      requiredFields: ['artist'],
      visibleFields: ['title', 'album', 'artist'],
      metaA: { artist: 'Halo', title: 'Sunrise' },
      libraryIndex: buildLibraryIndex([{ title: 'Sunrise', artist: 'Halo', persistentId: 'P1' }]),
    })
    expect(screen.getByTestId('batch-plan-blocked')).toHaveTextContent(
      i18n.t('editor.mixedReplaceSelection'),
    )
    expect(screen.queryByTestId('process-blocked-face')).toBeNull()
    fireEvent.click(screen.getByTestId('process-btn'))
    expect(document.activeElement).not.toBe(screen.getByTestId('field-artist'))
  })

  it('measures no library copy with several tracks selected, since the button warns about one track only', async () => {
    const api = window.api as unknown as Record<string, unknown>
    api.appleMusicEntryLocation = vi.fn().mockResolvedValue('/Music/Sunrise.wav')
    api.loudness = vi.fn().mockResolvedValue(null)
    api.comparePair = vi.fn().mockResolvedValue(null)
    renderMulti({
      platform: 'darwin',
      music: true,
      loudness: true,
      metaA: { artist: 'Halo', title: 'Sunrise' },
      libraryIndex: buildLibraryIndex([{ title: 'Sunrise', artist: 'Halo', persistentId: 'P1' }]),
    })
    await waitFor(() => expect(api.appleMusicEntryLocation).toHaveBeenCalledWith('P1'))
    await new Promise((r) => setTimeout(r, 50))
    expect(api.comparePair).not.toHaveBeenCalled()
    expect(api.loudness).not.toHaveBeenCalledWith('/Music/Sunrise.wav', expect.anything())
  })

  it('does not send the DJ to a field from the amber note either when the selection mixes replacing with adding', () => {
    renderMulti({
      requiredFields: ['artist'],
      visibleFields: ['title', 'album', 'artist'],
      metaA: { artist: 'Halo', title: 'Sunrise' },
      libraryIndex: buildLibraryIndex([{ title: 'Sunrise', artist: 'Halo', persistentId: 'P1' }]),
    })
    fireEvent.click(screen.getByTestId('batch-plan-blocked'))
    expect(document.activeElement).not.toBe(screen.getByTestId('field-artist'))
  })

  // One track marks its empty required field with the amber dot; a selection that held the
  // same gap back showed only the note below, so the DJ could not see which field to fill.
  it('marks a required Grouping that one selected track still misses, as one track does', () => {
    renderMulti({
      requiredFields: ['grouping'],
      visibleFields: ['title', 'grouping'],
      groupingPresets: ['Warm-up'],
    })
    expect(screen.getByTestId('field-required-grouping')).toBeInTheDocument()
  })

  it('keeps the mark while only some of the selected tracks have the required Grouping', () => {
    renderMulti({
      requiredFields: ['grouping'],
      visibleFields: ['title', 'grouping'],
      metaA: { grouping: 'Warm-up' },
    })
    expect(screen.getByTestId('field-required-grouping')).toBeInTheDocument()
  })

  it('drops the mark once every selected track has the required Grouping', () => {
    renderMulti({
      requiredFields: ['grouping'],
      visibleFields: ['title', 'grouping'],
      metaA: { grouping: 'Warm-up' },
      metaB: { grouping: 'Peak' },
    })
    expect(screen.queryByTestId('field-required-grouping')).toBeNull()
  })

  it('marks a required text field a selection misses in a track', () => {
    renderMulti({
      requiredFields: ['artist'],
      visibleFields: ['title', 'artist'],
      metaA: { artist: 'Kumara' },
    })
    expect(screen.getByTestId('field-required-artist')).toBeInTheDocument()
  })

  it('marks a required custom field a selection misses in a track', () => {
    renderMulti({
      requiredFields: ['mood'],
      visibleFields: ['title', 'mood'],
      customFields: [{ key: 'mood', label: 'Mood' }],
    })
    expect(screen.getByTestId('field-required-mood')).toBeInTheDocument()
  })

  // Genre and Grouping have no text box, so "field-grouping" does not exist for a selection:
  // the press must land on their chips instead of doing nothing.
  it('focuses the Grouping chips when the missing required field is Grouping and the notice is pressed', () => {
    renderMulti({
      requiredFields: ['grouping'],
      visibleFields: ['title', 'grouping'],
      groupingPresets: ['Warm-up'],
    })
    fireEvent.click(screen.getByTestId('process-btn'))
    expect(screen.getByTestId('grouping-bulk').contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(document.body)
  })

  // Title is per track in a selection, so its box is read-only. A press that lands there
  // must still be seen: the field is the answer to "why can't I convert".
  it('takes a blocked press to a per-track Title that stays visible to the keyboard', () => {
    renderMulti({
      requiredFields: ['title'],
      visibleFields: ['title', 'album'],
      metaA: { title: '' },
      metaB: { title: '' },
    })
    fireEvent.click(screen.getByTestId('process-btn'))
    const title = screen.getByTestId('field-title')
    expect(document.activeElement).toBe(title)
    expect(title).not.toHaveAttribute('aria-hidden')
  })

  it('focuses the per-track toggle when Grouping has no chips to land on', () => {
    renderMulti({ requiredFields: ['grouping'], visibleFields: ['title', 'grouping'] })
    fireEvent.click(screen.getByTestId('process-btn'))
    expect(document.activeElement).toBe(screen.getByTestId('grouping-per-track-toggle'))
  })

  it('names the missing fields in the batch plan', () => {
    renderMulti({ requiredFields: ['artist'], metaA: { artist: 'Kumara' } })
    expect(screen.getByTestId('batch-plan-blocked')).toHaveTextContent(i18n.t('fields.artist'))
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

  // With the Apple Music setting on, the plan must say so for the selection just like the
  // single-track button does, so the user knows the batch will be added too.
  it('says the batch is added to Apple Music when the setting is on', () => {
    renderMulti({ platform: 'darwin', music: true })
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    expect(screen.getByTestId('process-destination-appleMusic')).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('writes a shared-field edit to every selected track', () => {
    const { onChangeAllMeta } = renderMulti()
    // The field buffers and commits on blur, so leaving the field is what pushes the edit up.
    const album = screen.getByTestId('field-album')
    fireEvent.change(album, { target: { value: 'New Album' } })
    fireEvent.blur(album)
    expect(onChangeAllMeta).toHaveBeenCalledWith(
      { album: 'New Album' },
      expect.objectContaining({ group: expect.any(String) }),
    )
  })

  it('tags every selected track with the selection size as its total tracks in one click', () => {
    const { onChangeAllMeta } = renderMulti({ visibleFields: ['title', 'trackTotal'] })
    fireEvent.click(screen.getByTestId('chip-2'))
    expect(onChangeAllMeta).toHaveBeenCalledWith(
      { trackTotal: '2' },
      expect.objectContaining({ group: expect.any(String) }),
    )
  })

  // App owns the numbering so the button and the ⌘K command agree on the order; the
  // button only hands the click over.
  it('hands numbering the selection over to App in one click', () => {
    const { onNumberTracks, onChangeTracksMeta } = renderMulti({
      visibleFields: ['title', 'trackNumber', 'trackTotal'],
    })
    fireEvent.click(screen.getByTestId('number-tracks-btn'))
    expect(onNumberTracks).toHaveBeenCalledOnce()
    expect(onChangeTracksMeta).not.toHaveBeenCalled()
  })

  // Year and Track no. sit in the same short column; Track no. drawn as loose text left a
  // gap of an invisible box between the ≠ and its button, so the button read as unrelated.
  it('draws mixed track numbers in a box like the year, with the numbering button beside it', () => {
    renderMulti({
      visibleFields: ['year', 'trackNumber'],
      metaA: { year: '2019', trackNumber: '1' },
      metaB: { year: '2020', trackNumber: '5' },
    })
    const year = screen.getByTestId('field-year')
    const number = screen.getByTestId('field-trackNumber')
    expect(number).toHaveAttribute('placeholder', year.getAttribute('placeholder'))
    expect(number).toHaveAttribute('readonly')
    expect(number).toHaveAccessibleDescription(i18n.t('editor.perTrackOnly'))
    expect(year).not.toHaveAttribute('readonly')
    expect(screen.getByTestId('number-tracks-btn')).toBeInTheDocument()
  })

  // Title and BPM are per-track like Track no.; loose text for them made the selection form
  // look unfinished next to the boxed Year, so every per-track field wears the same dashed box.
  it('draws differing titles and BPMs in the same box as the track number', () => {
    renderMulti({
      visibleFields: ['title', 'bpm', 'trackNumber'],
      metaA: { title: 'One', bpm: '120', trackNumber: '1' },
      metaB: { title: 'Two', bpm: '128', trackNumber: '5' },
    })
    for (const id of ['field-title', 'field-bpm', 'field-trackNumber']) {
      expect(screen.getByTestId(id)).toHaveAttribute('readonly')
      expect(screen.getByTestId(id)).toHaveAccessibleDescription(i18n.t('editor.perTrackOnly'))
    }
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
    expect(onChangeAllMeta).toHaveBeenCalledWith(
      { compilation: '1' },
      expect.objectContaining({ group: expect.any(String) }),
    )
  })

  // Clearing over a selection goes through the same shared-form channel as any
  // multi edit, so every selected track is emptied, not just the primary one.
  it('hands a selection clear to the one channel that records tags and artwork as a single undo step', () => {
    const { onClearAll, onChangeAllMeta } = renderMulti()
    fireEvent.click(screen.getByTestId('clear-meta-btn'))
    expect(onClearAll).toHaveBeenCalledTimes(1)
    expect(onChangeAllMeta).not.toHaveBeenCalled()
  })

  // The same post-convert "Add to Apple Music" action is reused for the selection rather
  // than reimplemented, so once every track is converted it adds them all in one click.
  // With a folder destination it sits in the more-actions menu.
  it('reuses the Apple Music add for the whole selection once converted', () => {
    const { onAddAllToAppleMusic } = renderMulti({ done: true, platform: 'darwin' })
    fireEvent.click(screen.getByTestId('done-more'))
    fireEvent.click(screen.getByTestId('menu-add-apple-music'))
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
    fireEvent.click(screen.getByTestId('done-more'))
    fireEvent.click(screen.getByTestId('process-btn'))
    expect(onProcessAll).toHaveBeenCalledWith('aiff')
  })

  // Same silent-empty-batch hole as the main convert button, through the done branch:
  // a required field emptied (or made required) after converting leaves every track
  // done, so the quiet Re-export shows — and eligibleForBatch would drop the whole
  // selection, running a batch of zero. The quiet button carries the same gate.
  it('disables the quiet re-export while a selected track is missing a required field', () => {
    const { onProcessAll } = renderMulti({
      done: true,
      requiredFields: ['artist'],
      metaA: { artist: 'Kumara' },
    })
    fireEvent.click(screen.getByTestId('done-more'))
    const btn = screen.getByTestId('process-btn')
    expect(btn).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(btn)
    expect(onProcessAll).not.toHaveBeenCalled()
  })
})

describe('Editor place across tracks', () => {
  // Reviewing the same section track after track (Trim, say) meant scrolling back down
  // to it on every switch: the editor remounts per track and opened at the top each time.
  it('opens the next track at the scroll position the last one was left at', () => {
    renderEditor({ id: 'a' })
    const scroller = screen.getByTestId('editor-scroll')
    scroller.scrollTop = 420
    fireEvent.scroll(scroller)
    cleanup()
    renderEditor({ id: 'b' })
    expect(screen.getByTestId('editor-scroll').scrollTop).toBe(420)
  })
})

describe('Editor scroll edge', () => {
  function scrolledTo(scroller: HTMLElement, scrollTop: number): void {
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 300 })
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 900 })
    scroller.scrollTop = scrollTop
    fireEvent.scroll(scroller)
  }

  // A hairline over the footer cut the spectrogram off mid-band, as if it ended there. The
  // content fading into the footer says it carries on below, and only while it does.
  it('fades the content into the footer while there is more below', () => {
    renderEditor({ id: 'a' })
    scrolledTo(screen.getByTestId('editor-scroll'), 0)
    expect(screen.getByTestId('editor-scroll')).toHaveAttribute('data-edge', 'true')
    expect(screen.getByTestId('editor-scroll-fade')).toBeVisible()
  })

  it('clears the fade once the last section is in view', () => {
    renderEditor({ id: 'a' })
    scrolledTo(screen.getByTestId('editor-scroll'), 600)
    expect(screen.getByTestId('editor-scroll')).toHaveAttribute('data-edge', 'false')
    expect(screen.getByTestId('editor-scroll-fade')).not.toBeVisible()
  })

  it('paints the fade as a layer beside the scroller, so a dialog opened inside it is never clipped', () => {
    renderEditor({ id: 'a' })
    scrolledTo(screen.getByTestId('editor-scroll'), 0)
    expect(screen.getByTestId('editor-scroll')).not.toContainElement(
      screen.getByTestId('editor-scroll-fade'),
    )
  })
})

describe('Editor convert line for a rekordbox track whose Music entry is this very file', () => {
  const read = { title: 'Strobe', artist: 'deadmau5', genre: 'Techno' }
  const track = (meta: Partial<TrackMetadata>) =>
    item({
      id: 'a',
      inputPath: '/music/a.aiff',
      fileName: 'a',
      programs: ['rekordbox'],
      meta,
      diskSignature: trackSignature(
        item({
          id: 'a',
          inputPath: '/music/a.aiff',
          fileName: 'a',
          programs: ['rekordbox'],
          meta: read,
        }),
      ),
    })

  beforeEach(() => {
    Object.assign(window.api, {
      platform: 'darwin',
      appleMusicEntryLocation: vi.fn().mockResolvedValue('/music/a.aiff'),
      libraryStatus: vi.fn<Api['libraryStatus']>().mockResolvedValue({
        rekordbox: { enabled: true, found: true },
        engine: { enabled: false, found: false },
        traktor: { enabled: false, found: false },
        serato: { enabled: false, found: false },
        virtualdj: { enabled: false, found: false },
      }),
    })
  })

  const libraryIndex = buildLibraryIndex([
    { title: 'Strobe', artist: 'deadmau5', persistentId: '0123456789ABCDEF' },
  ])

  it('reads as no changes while nothing is edited', async () => {
    renderEditor({ ...track(read) }, 'aiff', { libraryIndex, addToRekordbox: true })
    await waitFor(() =>
      expect(window.api.appleMusicEntryLocation).toHaveBeenCalledWith('0123456789ABCDEF'),
    )
    expect(screen.getByTestId('convert-up-to-date')).toBeInTheDocument()
  })

  it('offers to update the tags, never to replace the copy, once a tag is edited', async () => {
    renderEditor({ ...track({ ...read, genre: 'House' }) }, 'aiff', {
      libraryIndex,
      addToRekordbox: true,
    })
    await waitFor(() =>
      expect(window.api.appleMusicEntryLocation).toHaveBeenCalledWith('0123456789ABCDEF'),
    )
    await act(async () => {})
    expect(screen.getByTestId('process-btn')).toHaveAccessibleName('Update')
  })

  it('retags its own Music entry on update instead of asking Music to replace the file with itself', async () => {
    const { onChange, onProcess } = renderEditor(
      { ...track({ ...read, genre: 'House' }) },
      'aiff',
      {
        libraryIndex,
        addToRekordbox: true,
      },
    )
    await waitFor(() =>
      expect(window.api.appleMusicEntryLocation).toHaveBeenCalledWith('0123456789ABCDEF'),
    )
    await act(async () => {})
    fireEvent.click(screen.getByTestId('process-btn'))
    expect(onProcess).toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledWith({ musicPersistentId: '0123456789ABCDEF' })
    expect(onChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ replacesPath: expect.anything() }),
    )
  })
  it('names no Music verb and offers no replacement while Music has not said where its copy lives', async () => {
    window.api.appleMusicEntryLocation = vi.fn(() => new Promise<string>(() => {}))
    renderEditor({ ...track({ ...read, genre: 'House' }) }, 'aiff', {
      libraryIndex,
      addToRekordbox: true,
    })
    await waitFor(() =>
      expect(window.api.appleMusicEntryLocation).toHaveBeenCalledWith('0123456789ABCDEF'),
    )
    expect(screen.getByTestId('process-btn')).toHaveAccessibleName('Update')
  })

  it('converts its own Music copy to another format without calling it a replacement', async () => {
    renderEditor({ ...track(read) }, 'mp3', { libraryIndex, addToRekordbox: true })
    await waitFor(() =>
      expect(window.api.appleMusicEntryLocation).toHaveBeenCalledWith('0123456789ABCDEF'),
    )
    await waitFor(() => expect(screen.getByTestId('process-btn')).toHaveAccessibleName('Convert'))
    expect(screen.getByTestId('process-format-current')).toHaveTextContent('MP3')
  })
})

describe('Editor convert button for a same-format file going to Apple Music', () => {
  const read = { title: 'Sometime', artist: 'La Luna' }
  const track = (meta: Partial<TrackMetadata>, over: Partial<TrackItem> = {}) =>
    item({
      id: 'a',
      inputPath: '/music/a.mp3',
      fileName: 'a',
      meta,
      diskSignature: trackSignature(
        item({ id: 'a', inputPath: '/music/a.mp3', fileName: 'a', meta: read }),
      ),
      ...over,
    })
  const without = buildLibraryIndex([
    { title: 'Strobe', artist: 'deadmau5', persistentId: '0123456789ABCDEF' },
  ])

  beforeEach(() => {
    Object.assign(window.api, { platform: 'darwin' })
  })

  // Reported 19/11: an MP3 Music had never seen read "Update" with Apple Music as
  // the destination, and the click also added it to Music.
  it('offers to add a file Music lacks instead of only updating its tags', () => {
    renderEditor({ ...track({ ...read, genre: 'Trance' }) }, 'mp3', { libraryIndex: without })
    expect(screen.getByTestId('process-btn')).toHaveAccessibleName('Add')
  })

  // Adding the track to Music is a change even with no tag edited, so the button must
  // not read as nothing to do.
  it('offers the add with nothing edited, never "No changes"', () => {
    renderEditor({ ...track(read) }, 'mp3', { libraryIndex: without })
    expect(screen.queryByTestId('convert-up-to-date')).not.toBeInTheDocument()
    expect(screen.getByTestId('process-btn')).toHaveAccessibleName('Add')
  })

  it('keeps "Update" for a track Music already holds', () => {
    renderEditor(
      { ...track({ ...read, genre: 'Trance' }, { musicPersistentId: 'AAAAAAAAAAAAAAAA' }) },
      'mp3',
      { libraryIndex: without },
    )
    expect(screen.getByTestId('process-btn')).toHaveAccessibleName('Update')
  })

  // Until Music has answered there is no telling whether it holds the file, and a
  // promise to add what is already there would be false.
  it('keeps "Update" while the Music library has not been read', () => {
    renderEditor({ ...track({ ...read, genre: 'Trance' }) }, 'mp3', { libraryIndex: null })
    expect(screen.getByTestId('process-btn')).toHaveAccessibleName('Update')
  })

  it('keeps "Update" when the destination is not Apple Music', () => {
    renderEditor({ ...track({ ...read, genre: 'Trance' }) }, 'mp3', {
      libraryIndex: without,
      addToAppleMusic: false,
      overwriteOriginal: true,
    })
    expect(screen.getByTestId('process-btn')).toHaveAccessibleName('Update')
  })
})

describe('Editor export control', () => {
  describe('when the file already carries the editor', () => {
    const read = { genre: 'Techno' }
    const diskSignature = trackSignature(item({ id: 'a', meta: read }))

    it('goes quiet instead of offering an update', () => {
      renderEditor({ id: 'a', meta: read, diskSignature })
      expect(screen.getByTestId('convert-up-to-date')).toHaveTextContent('No changes')
      expect(screen.queryByTestId('process-btn')).toBeNull()
    })

    it('offers the update when it shows values a library filled in that the file lacks', () => {
      renderEditor({ id: 'a', meta: read, diskSignature, fillSignature: diskSignature })
      expect(screen.getByTestId('process-btn')).toHaveAccessibleName('Update')
      expect(screen.queryByTestId('convert-up-to-date')).toBeNull()
    })

    it('offers the update when it shows a title the file does not hold', () => {
      renderEditor({
        id: 'a',
        meta: read,
        diskSignature,
        notInFile: { signature: diskSignature, fields: ['title'] },
      })
      expect(screen.getByTestId('process-btn')).toHaveAccessibleName('Update')
      expect(screen.queryByTestId('convert-up-to-date')).toBeNull()
    })

    it('goes quiet again once a conversion wrote those values', () => {
      renderEditor({
        id: 'a',
        meta: read,
        diskSignature,
        fillSignature: 'an earlier read',
        notInFile: { signature: 'an earlier read', fields: ['title'] },
      })
      expect(screen.getByTestId('convert-up-to-date')).toBeInTheDocument()
    })

    it('goes quiet when the pattern only adds folders an in-place edit ignores', () => {
      const titled = { ...read, title: 'a.wav' }
      const signature = trackSignature(item({ id: 'a', meta: titled }))
      renderEditor({ id: 'a', meta: titled, diskSignature: signature }, 'wav', {
        autoApplyFilename: true,
        filenameFormat: '2026/11/{title}',
      })
      expect(screen.getByTestId('convert-up-to-date')).toHaveTextContent('No changes')
    })

    it('offers the update while an edit is staged', () => {
      renderEditor({ id: 'a', meta: { genre: 'House' }, diskSignature })
      expect(screen.getByTestId('process-btn')).toHaveAccessibleName('Update')
      expect(screen.queryByTestId('convert-up-to-date')).toBeNull()
    })

    it('shows the blocked face instead when a required tag is missing', () => {
      renderEditor({ id: 'a', meta: read, diskSignature }, 'wav', { requiredFields: ['artist'] })
      expect(screen.queryByTestId('convert-up-to-date')).toBeNull()
      expect(screen.getByTestId('process-btn')).toHaveAttribute('aria-disabled', 'true')
    })

    it('never reads a new normalization as no changes', () => {
      renderEditor({ id: 'a', meta: read, diskSignature }, 'wav', {
        normalize: { mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
      })
      expect(screen.queryByTestId('convert-up-to-date')).toBeNull()
      expect(screen.getByTestId('process-btn')).toHaveAccessibleName('Update tags and audio')
    })

    function EditableHarness({ start }: { start: TrackItem }) {
      const [track, setTrack] = useState(start)
      return (
        <Editor
          item={track}
          libraryIndex={null}
          searchInputRef={createRef<HTMLInputElement>()}
          onChange={(patch) => setTrack((t) => ({ ...t, ...patch }))}
          onProcess={vi.fn()}
          onAddToAppleMusic={vi.fn()}
          resultsFolded={false}
          onFoldResults={vi.fn()}
          onResultsResizeStart={vi.fn()}
          onResultsFit={vi.fn()}
          onShowLoudnessHelp={vi.fn()}
          onHideEditorHints={vi.fn()}
          onOpenRename={vi.fn()}
          onRegenerateName={vi.fn()}
          onTrimDetectedAll={vi.fn()}
          onCopyFilename={vi.fn()}
          onCopyPath={vi.fn()}
          onSearchWeb={vi.fn()}
          onCopyMeta={vi.fn()}
          onPasteMeta={vi.fn()}
          copiedMetaTitle={null}
          onExportCollection={vi.fn()}
          readFullTrack={async () => undefined}
          filesOpen
        />
      )
    }

    const typeInto = (testId: string, value: string): void => {
      const field = screen.getByTestId(testId)
      fireEvent.focus(field)
      fireEvent.change(field, { target: { value } })
      fireEvent.blur(field)
    }

    it('goes quiet again once an edit is undone back to the read values', () => {
      renderWithQuery(<EditableHarness start={item({ id: 'a', meta: read, diskSignature })} />, {
        outputFormat: 'wav',
        addToAppleMusic: false,
        visibleFields: ['genre'],
        requiredFields: [],
        normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
      })
      expect(screen.getByTestId('convert-up-to-date')).toBeInTheDocument()
      typeInto('field-genre', 'House')
      expect(screen.queryByTestId('convert-up-to-date')).toBeNull()
      expect(screen.getByTestId('process-btn')).toHaveAccessibleName('Update')
      typeInto('field-genre', 'Techno')
      expect(screen.getByTestId('convert-up-to-date')).toBeInTheDocument()
    })

    it('never goes quiet while the pattern would rename the file', () => {
      const named = { artist: 'Halo', title: 'Sunrise' }
      renderEditor(
        { id: 'a', meta: named, diskSignature: trackSignature(item({ id: 'a', meta: named })) },
        'wav',
        { autoApplyFilename: true, filenameFormat: '{artist} - {title}' },
      )
      expect(screen.queryByTestId('convert-up-to-date')).toBeNull()
      expect(screen.getByTestId('process-btn')).toHaveAccessibleName('Update')
    })

    it('goes quiet with the pattern on when it names the file as it already is', () => {
      const named = { artist: 'Halo', title: 'Sunrise' }
      renderEditor(
        {
          id: 'a',
          fileName: 'Halo - Sunrise',
          meta: named,
          diskSignature: trackSignature(item({ id: 'a', fileName: 'Halo - Sunrise', meta: named })),
        },
        'wav',
        { autoApplyFilename: true, filenameFormat: '{artist} - {title}' },
      )
      expect(screen.getByTestId('convert-up-to-date')).toBeInTheDocument()
    })

    // Right after importing a folder every track is selected and none is edited: the footer
    // has to read as quietly as it does for one untouched track, or the new user is pushed
    // to rewrite files that already carry what the editor shows.
    describe('over a selection', () => {
      const untouched = (id: string): TrackItem =>
        item({ id, meta: read, diskSignature: trackSignature(item({ id, meta: read })) })

      function renderSelection(
        tracks: TrackItem[],
        libraryIndex: AppleMusicIndex | null = null,
        settings: Partial<Settings> = {},
      ) {
        const onConvertSelection = vi.fn()
        const ui = (selected: TrackItem[]) => (
          <Editor
            item={selected[0]}
            selectedTracks={selected}
            libraryIndex={libraryIndex}
            searchInputRef={createRef<HTMLInputElement>()}
            onExportCollection={vi.fn()}
            readFullTrack={async () => undefined}
            filesOpen
            resultsFolded={false}
            onFoldResults={vi.fn()}
            onResultsResizeStart={vi.fn()}
            onResultsFit={vi.fn()}
            onApplyMatches={vi.fn()}
            onProcessAll={vi.fn()}
            onConvertSelection={onConvertSelection}
            onAddAllToAppleMusic={vi.fn()}
            onChangeAllMeta={vi.fn()}
            onApplyCoverAll={vi.fn()}
            onDeriveTags={vi.fn()}
            onChange={vi.fn()}
            onProcess={vi.fn()}
            onAddToAppleMusic={vi.fn()}
            onShowLoudnessHelp={vi.fn()}
            onHideEditorHints={vi.fn()}
            onOpenRename={vi.fn()}
            onRegenerateName={vi.fn()}
            onTrimDetectedAll={vi.fn()}
            onCopyFilename={vi.fn()}
            onCopyPath={vi.fn()}
            onSearchWeb={vi.fn()}
            onCopyMeta={vi.fn()}
            onPasteMeta={vi.fn()}
            copiedMetaTitle={null}
          />
        )
        const { rerenderUi } = renderWithQuery(ui(tracks), {
          outputFormat: 'wav',
          addToAppleMusic: true,
          visibleFields: ['genre'],
          requiredFields: [],
          normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
          ...settings,
        })
        return { onConvertSelection, rerender: (next: TrackItem[]) => rerenderUi(ui(next)) }
      }

      it('goes quiet when no selected track is edited, and the quiet face updates them all', () => {
        const { onConvertSelection } = renderSelection([
          untouched('a'),
          untouched('b'),
          untouched('c'),
        ])
        expect(screen.getByTestId('convert-up-to-date-row')).toBeInTheDocument()
        expect(screen.getByTestId('convert-up-to-date')).toHaveTextContent('No changes')
        expect(screen.queryByTestId('process-btn')).toBeNull()
        fireEvent.click(screen.getByTestId('convert-update-anyway'))
        expect(onConvertSelection).toHaveBeenCalledTimes(1)
      })

      it('brings the update back while one selected track is edited, and quiets on undo', () => {
        const edited = { ...untouched('b'), meta: { ...untouched('b').meta, genre: 'House' } }
        const { rerender, onConvertSelection } = renderSelection([
          untouched('a'),
          edited,
          untouched('c'),
        ])
        expect(screen.queryByTestId('convert-up-to-date-row')).toBeNull()
        fireEvent.click(screen.getByTestId('process-btn'))
        expect(onConvertSelection).toHaveBeenCalledTimes(1)
        rerender([untouched('a'), untouched('b'), untouched('c')])
        expect(screen.getByTestId('convert-up-to-date-row')).toBeInTheDocument()
        expect(screen.queryByTestId('process-btn')).toBeNull()
      })

      it('keeps the update while one selected track would be renamed', () => {
        renderSelection([untouched('a'), { ...untouched('b'), outputName: 'renamed' }])
        expect(screen.queryByTestId('convert-up-to-date-row')).toBeNull()
        expect(screen.getByTestId('process-btn')).toBeInTheDocument()
      })

      // The batch would add the tracks Music lacks, which is something it writes.
      it('keeps the update while the selection would be added to Music', () => {
        ;(window as unknown as { api: { platform: string } }).api.platform = 'darwin'
        const titled = (id: string, title: string): TrackItem => {
          const meta = { ...read, title, artist: 'deadmau5' }
          return item({ id, meta, diskSignature: trackSignature(item({ id, meta })) })
        }
        renderSelection(
          [titled('a', 'Strobe'), titled('b', 'Ghosts n Stuff')],
          buildLibraryIndex([
            { title: 'Raise Your Weapon', artist: 'deadmau5', persistentId: 'A1' },
          ]),
        )
        expect(screen.queryByTestId('convert-up-to-date-row')).toBeNull()
        expect(screen.getByTestId('process-btn')).toBeInTheDocument()
      })

      // The run names the file with the quality its spectrum gives, so before that is known a
      // {quality} pattern may still rename it.
      describe('with the quality in the name pattern', () => {
        const named = (id: string): TrackItem => {
          const meta = { ...read, title: `${id}.wav` }
          return item({ id, meta, diskSignature: trackSignature(item({ id, meta })) })
        }
        const naming = (filenameFormat: string): Partial<Settings> => ({
          autoApplyFilename: true,
          filenameFormat,
          importFields: ['quality'],
        })

        it('keeps the update while a track has no quality yet', () => {
          renderSelection([named('a'), named('b')], null, naming('{title}{quality}'))
          expect(screen.queryByTestId('convert-up-to-date-row')).toBeNull()
          expect(screen.getByTestId('process-btn')).toBeInTheDocument()
        })

        it('goes quiet when the pattern does not name the quality', () => {
          renderSelection([named('a'), named('b')], null, naming('{title}'))
          expect(screen.getByTestId('convert-up-to-date-row')).toBeInTheDocument()
        })
      })

      it('keeps the update while one selected track shows values the file lacks', () => {
        const b = untouched('b')
        renderSelection([untouched('a'), { ...b, fillSignature: b.diskSignature }])
        expect(screen.queryByTestId('convert-up-to-date-row')).toBeNull()
      })
    })
  })

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
    fireEvent.click(screen.getByTestId('done-more'))
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
    fireEvent.click(screen.getByTestId('done-more'))
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
    fireEvent.click(screen.getByTestId('done-more'))
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
    expect(screen.getByTestId('add-apple-music')).toHaveAccessibleName('Update in Apple Music')
  })

  // Once the library copy is in sync, a disabled "Added ✓" is a dead end — the slot
  // becomes the reveal, jumping to this exact track in the Music window. A folder export
  // the user then added by hand: with Apple Music as the destination the confirmation
  // itself is the reveal (ConvertFooter's done layout).
  it('turns the synced state into a "Show in Apple Music" action that reveals the library copy', () => {
    const revealAppleMusic = vi.fn().mockResolvedValue(undefined)
    const api = (window as unknown as { api: { platform: string; revealAppleMusic: unknown } }).api
    api.platform = 'darwin'
    api.revealAppleMusic = revealAppleMusic
    renderEditor(
      {
        id: 'a',
        status: 'done',
        outputPath: '/out/a.wav',
        musicStatus: 'added',
        musicPersistentId: 'ABCD1234',
      },
      'wav',
      { addToAppleMusic: false },
    )
    const btn = screen.getByTestId('add-apple-music')
    expect(btn).toHaveAccessibleName('Show in Apple Music')
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

  // Djotas's report: the editor remounts per track, so a normalization dialled on one
  // track was re-seeded from the global default on the way back and the choice was gone.
  // A track that carries its own setting must open showing it.
  it('seeds the normalization from the track when it has its own', () => {
    renderEditor(
      {
        id: 'a',
        normalize: { mode: 'loudness', targetLufs: -9, truePeakDb: -1, peakDb: -1 },
      },
      'wav',
      { editorSections: [{ id: 'normalize' as const, open: true }] },
    )
    expect(screen.getByTestId('normalize-mode-loudness')).toHaveAttribute('aria-pressed', 'true')
  })

  // Same remount story as the normalization above: a click-repair level dialled for a
  // dusty rip was re-seeded from the global default on the way back, so the choice was
  // silently gone. Click repair is per track exactly like trim and normalize.
  it('seeds the click repair from the track when it has its own', () => {
    renderEditor({ id: 'a', declick: { mode: 'strong', noise: 'off' } }, 'wav', {
      declick: { mode: 'off', noise: 'off' },
      editorSections: [{ id: 'declick' as const, open: true }],
    })
    expect(screen.getByTestId('declick-mode-strong')).toHaveAttribute('aria-pressed', 'true')
  })

  // The inline-explanations switch hides what each click-repair step does in the editor
  // too, as it already did for the normalization lines below.
  it('drops the click-repair step explanations when inline explanations are off', () => {
    renderEditor({ id: 'a' }, 'wav', {
      showEditorHints: false,
      editorSections: [{ id: 'declick' as const, open: true }],
    })
    expect(screen.getByTestId('declick-mode-off')).toBeInTheDocument()
    expect(screen.queryByTestId('declick-mode-hint')).not.toBeInTheDocument()
    expect(screen.queryByTestId('declick-noise-hint')).not.toBeInTheDocument()
  })

  // The other half of the same contract: an untouched track still opens on the Settings
  // default, so configuring click repair globally governs freshly imported tracks.
  it('seeds the click repair from Settings when the track has none', () => {
    renderEditor({ id: 'a' }, 'wav', {
      declick: { mode: 'soft', noise: 'off' },
      editorSections: [{ id: 'declick' as const, open: true }],
    })
    expect(screen.getByTestId('declick-mode-soft')).toHaveAttribute('aria-pressed', 'true')
  })

  // Dialling a level must stage it ON the track, or coming back finds the global value.
  it('stages the click repair on the track when it changes', () => {
    const { onChange } = renderEditor({ id: 'a' }, 'wav', {
      declick: { mode: 'off', noise: 'off' },
      editorSections: [{ id: 'declick' as const, open: true }],
    })
    fireEvent.click(screen.getByTestId('declick-mode-standard'))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ declick: { mode: 'standard', noise: 'off' } }),
    )
  })

  // The other half: a track the user never touched still opens on the Settings default,
  // so configuring loudness globally keeps working for freshly imported tracks.
  it('seeds the normalization from Settings when the track has none', () => {
    renderEditor({ id: 'a' }, 'wav', {
      normalize: { mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
      editorSections: [{ id: 'normalize' as const, open: true }],
    })
    expect(screen.getByTestId('normalize-mode-loudness')).toHaveAttribute('aria-pressed', 'true')
  })

  // The section order below the metadata form is the user's (Settings → Editor): a DJ
  // who tunes loudness before naming the file puts Normalization above File name, and
  // the editor must honor that instead of hardcoding one editorial order.
  it('renders the sections in the settings-configured order', () => {
    renderEditor({ id: 'a' }, 'wav', {
      showSpectrum: true,
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
      screen.getByText('Output name'),
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

  // Other Metadata is now a section of its own — it shows for a single track that carries
  // foreign tags, independent of the metadata form's own fold state.
  it('renders Other Metadata as a section when the track has foreign tags', () => {
    renderEditor({ id: 'a', foreignTags: [{ name: 'SERATO_MARKERS_V2', value: 'x' }] }, 'wav', {
      editorSections: [
        { id: 'form', open: true },
        { id: 'otherTags', open: false },
        { id: 'properties', open: false },
        { id: 'quality', open: false },
        { id: 'normalize', open: false },
        { id: 'output', open: false },
      ],
    })
    expect(screen.getByTestId('foreign-tags-toggle')).toBeInTheDocument()
  })

  // A tag the user made into a field of their own leaves Other Metadata for the form: it
  // shows there with the value the file carries, and an edit goes to that field.
  it('shows a custom field with the file value and keeps its tag out of Other Metadata', () => {
    const { onChange } = renderEditor(
      { id: 'a', foreignTags: [{ name: 'VINYLCONDITION', value: 'NM' }] },
      'wav',
      {
        visibleFields: ['title', 'vinylCondition'],
        customFields: [{ key: 'vinylCondition', label: 'Estado del vinilo' }],
        editorSections: [
          { id: 'form', open: true },
          { id: 'otherTags', open: true },
          { id: 'properties', open: false },
          { id: 'quality', open: false },
          { id: 'normalize', open: false },
          { id: 'output', open: false },
        ],
      },
    )
    const field = screen.getByTestId('field-vinylCondition')
    expect(field).toHaveValue('NM')
    expect(screen.queryByTestId('foreign-tags-toggle')).not.toBeInTheDocument()
    fireEvent.change(field, { target: { value: 'VG+' } })
    fireEvent.blur(field)
    expect(onChange.mock.calls.at(-1)?.[0].meta.custom).toEqual({ vinylCondition: 'VG+' })
  })

  // The inspector returns null with no foreign tags, so the section shows nothing rather
  // than an empty header even when the section is enabled.
  it('does not render Other Metadata when the track has no foreign tags', () => {
    renderEditor({ id: 'a', foreignTags: [] }, 'wav', {
      editorSections: [
        { id: 'form', open: true },
        { id: 'otherTags', open: false },
        { id: 'properties', open: false },
        { id: 'quality', open: false },
        { id: 'normalize', open: false },
        { id: 'output', open: false },
      ],
    })
    expect(screen.queryByTestId('foreign-tags-toggle')).not.toBeInTheDocument()
  })

  // Hiding the section in Settings removes it from the editor even for a track that has
  // foreign tags — the eye toggle is how a DJ drops a section they never use.
  it('does not render Other Metadata when the section is hidden', () => {
    renderEditor({ id: 'a', foreignTags: [{ name: 'SERATO_MARKERS_V2', value: 'x' }] }, 'wav', {
      editorSections: [
        { id: 'form', open: true },
        { id: 'otherTags', open: false, hidden: true },
        { id: 'properties', open: false },
        { id: 'quality', open: false },
        { id: 'normalize', open: false },
        { id: 'output', open: false },
      ],
    })
    expect(screen.queryByTestId('foreign-tags-toggle')).not.toBeInTheDocument()
  })

  // Clicking a live tag's button marks it for deletion.
  it('marks a foreign tag for removal on click', () => {
    const { onChange } = renderEditor(
      { id: 'a', foreignTags: [{ name: 'SERATO_MARKERS_V2', value: 'x' }], foreignRemoved: [] },
      'wav',
      {
        editorSections: [
          { id: 'form', open: true },
          { id: 'otherTags', open: true },
          { id: 'properties', open: false },
          { id: 'quality', open: false },
          { id: 'normalize', open: false },
          { id: 'output', open: false },
        ],
      },
    )
    fireEvent.click(screen.getByTestId('foreign-tag-remove'))
    expect(onChange).toHaveBeenCalledWith({ foreignRemoved: ['SERATO_MARKERS_V2'] })
  })

  // The bug this fixes: clicking an already-marked tag un-marks it (removes it from
  // foreignRemoved) instead of doing nothing, so a mis-click is reversible in place.
  it('un-marks a foreign tag already marked for removal', () => {
    const { onChange } = renderEditor(
      {
        id: 'a',
        foreignTags: [{ name: 'SERATO_MARKERS_V2', value: 'x' }],
        foreignRemoved: ['SERATO_MARKERS_V2'],
      },
      'wav',
      {
        editorSections: [
          { id: 'form', open: true },
          { id: 'otherTags', open: true },
          { id: 'properties', open: false },
          { id: 'quality', open: false },
          { id: 'normalize', open: false },
          { id: 'output', open: false },
        ],
      },
    )
    fireEvent.click(screen.getByTestId('foreign-tag-remove'))
    expect(onChange).toHaveBeenCalledWith({ foreignRemoved: [] })
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
    expect(screen.queryByTestId('reveal-file-btn')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Metadata' }))
    expect(screen.getByTestId('clear-meta-btn')).toBeInTheDocument()
    openMore()
    expect(screen.getByTestId('copy-filename-btn')).toBeInTheDocument()
  })

  // The header collapsed to a single row: the action buttons keep their tooltips/aria-labels
  // (so the File/Tags meaning survives), but the inline text labels are gone — the row reads
  // as one line, like OUTPUT and PROPERTIES, instead of two stacked rows.
  it('shows the header action buttons without inline group labels', () => {
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav')
    openMore()
    expect(screen.getByTestId('copy-filename-btn')).toBeInTheDocument()
    expect(screen.getByTestId('clear-meta-btn')).toBeInTheDocument()
    expect(screen.queryByTestId('actions-file-label')).not.toBeInTheDocument()
    expect(screen.queryByTestId('actions-tags-label')).not.toBeInTheDocument()
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
    expect(screen.getByTestId('process-btn')).toHaveAccessibleName('Update')
  })

  // With Keep MP3 on, "converting to AIFF" an mp3 is actually an in-place tag
  // edit: the button must say "Update", not promise an AIFF that never gets written.
  it('labels the button "Update" for an mp3 source when keep mp3 is on', () => {
    renderEditor({ id: 'a', inputPath: '/music/a.mp3', fileName: 'a.mp3' }, 'aiff', {
      keepMp3Sources: true,
    })
    expect(screen.getByTestId('process-btn')).toHaveAccessibleName('Update')
  })

  it.each<[string, Parameters<typeof renderEditor>]>([
    [
      'normalize',
      [
        { id: 'a', inputPath: '/music/a.wav' },
        'wav',
        { normalize: { mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 } },
      ],
    ],
    [
      'declick',
      [
        { id: 'a', inputPath: '/music/a.wav' },
        'wav',
        { declick: { mode: 'standard', noise: 'off' } },
      ],
    ],
    ['trim', [{ id: 'a', inputPath: '/music/a.wav', trim: { startSec: 2 } }, 'wav']],
  ])('labels a same-format export with a staged %s as a tags and audio update', (_, args) => {
    renderEditor(...args)
    expect(screen.getByTestId('process-btn')).toHaveTextContent('Update tags and audio')
  })

  // "Same as source" keeps the file's own format, so with nothing staged it is a tag
  // update like picking that format by hand.
  it('labels a "Same as source" export with nothing staged "Update"', () => {
    renderEditor({ id: 'a', inputPath: '/music/a.flac' }, 'source')
    expect(screen.getByTestId('process-btn')).toHaveAccessibleName('Update')
  })

  // Overwrite mode edits the original's path whatever the format, but a WAV overwritten
  // as AIFF is re-encoded: the button must promise the conversion, not a tag update.
  it('labels an overwrite into another format as a conversion', () => {
    renderEditor({ id: 'a', inputPath: '/music/a.wav' }, 'aiff', { overwriteOriginal: true })
    const button = screen.getByTestId('process-btn')
    expect(button).toHaveAccessibleName('Convert')
    expect(screen.getByTestId('process-format-current')).toHaveTextContent('AIFF')
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

  // The verb stays on the main half and the dropdown shows the pick over the same stack of
  // names, so a format change moves neither half.
  it('shows the format chosen from the dropdown on the dropdown, over the same stacked names', () => {
    renderEditor({ id: 'a', inputPath: '/music/a.flac' }, 'aiff')
    expect(screen.getByTestId('process-btn')).toHaveTextContent(/^Convert$/)
    expect(screen.getByTestId('process-format-current')).toHaveTextContent('AIFF')
    const sized = screen.getByTestId('process-format-toggle').textContent
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.click(screen.getByTestId('process-format-wav'))
    expect(screen.getByTestId('process-format-current')).toHaveTextContent('WAV')
    expect(screen.getByTestId('process-format-toggle').textContent).toBe(sized)
    expect(screen.getByTestId('process-btn')).toHaveTextContent(/^Convert$/)
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
  // App mirrors the editor's picks in refs for the keyboard convert shortcuts and convert
  // all. The seeded format is resolved against this track alone, so the mount report says
  // "nothing picked" rather than the seed: reported as a pick, an open MP3 turned every
  // FLAC and WAV of a convert all into MP3.
  it('reports no format pick on mount, only the reset of a previous one', () => {
    const { onFormatChange } = renderEditor({ id: 'a' }, 'wav')
    expect(onFormatChange).toHaveBeenCalledTimes(1)
    expect(onFormatChange).toHaveBeenCalledWith(null)
  })

  // 'source' can never reach onProcess (OutputFormat-typed) or the in-place/re-encode
  // checks, which all key off the item's own extension — the editor must resolve it
  // against the track before seeding, same as a job would.
  it('resolves a "same as source" default against the track before seeding', () => {
    const { onProcess } = renderEditor({ id: 'a' }, 'source')
    fireEvent.click(screen.getByTestId('process-btn'))
    expect(onProcess).toHaveBeenCalledWith('wav')
  })

  // Apple Music can't ingest FLAC. With "Same as source" and Apple Music configured,
  // a .flac track must seed the 'folder' destination — checking the raw setting
  // ('source') instead of the resolved format wrongly reads it as non-FLAC and seeds
  // 'appleMusic', offering an import the format can't survive.
  it('seeds the folder destination for a "same as source" FLAC track with Apple Music configured', () => {
    const { onDestinationChange } = renderEditor(
      { id: 'a', inputPath: '/music/a.flac', fileName: 'a.flac' },
      'source',
      { addToAppleMusic: true },
    )
    expect(onDestinationChange).toHaveBeenCalledWith('folder')
  })

  it('reports the picked format so the keyboard shortcut can match it', () => {
    const { onFormatChange } = renderEditor({ id: 'a' }, 'wav')
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.click(screen.getByTestId('process-format-mp3'))
    expect(onFormatChange).toHaveBeenCalledWith('mp3')
  })
})

describe('Editor clean up previous files', () => {
  // A real conversion leaves the source file untouched beside the converted copy,
  // so once a track is done the user can reclaim the disk by trashing the original
  // — the converted output (and its row) stays.
  it('offers to clean up the original once a real conversion is done', () => {
    const { onCleanUp } = renderEditor({
      id: 'a',
      status: 'done',
      inputPath: '/music/a.wav',
      outputPath: '/out/a.aiff',
      verification: { status: 'ok', checks: [] },
    })
    expect(screen.getByTestId('clean-up-previous')).toHaveAccessibleName(/previous file/)
    fireEvent.click(screen.getByTestId('clean-up-previous'))
    expect(onCleanUp).toHaveBeenCalledWith({
      originalPath: '/music/a.wav',
      superseded: [],
      staleMusicCopy: null,
    })
  })

  // An in-place export rewrites and renames the original, so inputPath now points at
  // the output: there is no separate original to delete, and offering it would trash
  // the only copy the user has.
  it('offers nothing for an in-place export', () => {
    renderEditor({
      id: 'a',
      status: 'done',
      inputPath: '/out/a.wav',
      outputPath: '/out/a.wav',
    })
    expect(screen.queryByTestId('clean-up-previous')).not.toBeInTheDocument()
  })

  // After the original is trashed the link has nothing left to act on, so it goes
  // away rather than letting a second click error on a missing file.
  it('offers nothing once the original is trashed', () => {
    renderEditor({
      id: 'a',
      status: 'done',
      inputPath: '/music/a.wav',
      outputPath: '/out/a.aiff',
      originalTrashed: true,
    })
    expect(screen.queryByTestId('clean-up-previous')).not.toBeInTheDocument()
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
    const { onCleanUp } = renderEditor(
      {
        id: 'a',
        status: 'done',
        outputPath: '/out/a.aiff',
        musicStatus: 'added',
        musicPersistentId: 'NEWCOPY123456789',
        verification: { status: 'ok', checks: [] },
        duration: 365,
        meta: { title: 'Save My Love (Original Mix)', artist: 'DJ Mofly' },
      },
      'aiff',
      { libraryIndex },
    )
    fireEvent.click(screen.getByTestId('clean-up-previous'))
    expect(onCleanUp).toHaveBeenCalledWith(
      expect.objectContaining({
        staleMusicCopy: {
          persistentId: 'OLDCOPY123456789',
          label: 'Djmofly - Save My Love (26 Rmx)',
        },
      }),
    )
  })

  // The old Music entry is deleted from the library: until the new file was re-read and
  // agrees, it may be the only good copy, so no clean-up is offered for it.
  it('does not offer the removal while the verification is pending', () => {
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
        musicStatus: 'added',
        musicPersistentId: 'NEWCOPY123456789',
        verification: { status: 'pending', checks: [] },
        duration: 365,
        meta: { title: 'Save My Love (Original Mix)', artist: 'DJ Mofly' },
      },
      'aiff',
      { libraryIndex },
    )
    expect(screen.queryByTestId('clean-up-previous')).not.toBeInTheDocument()
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
    const { onCleanUp } = renderEditor(
      {
        id: 'a',
        status: 'done',
        outputPath: '/out/a.aiff',
        musicStatus: 'added',
        musicPersistentId: 'NEWCOPY123456789',
        verification: { status: 'ok', checks: [] },
        duration: 365,
        meta: { title: 'Save My Love (Original Mix)', artist: 'DJ Mofly' },
      },
      'aiff',
      { libraryIndex },
    )
    fireEvent.click(screen.getByTestId('clean-up-previous'))
    expect(onCleanUp).toHaveBeenCalledWith(expect.objectContaining({ staleMusicCopy: null }))
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
    const { onCleanUp } = renderEditor(
      {
        id: 'a',
        status: 'done',
        outputPath: '/out/a.aiff',
        verification: { status: 'ok', checks: [] },
        duration: 365,
        meta: { title: 'Save My Love (Original Mix)', artist: 'DJ Mofly' },
      },
      'aiff',
      { libraryIndex },
    )
    fireEvent.click(screen.getByTestId('clean-up-previous'))
    expect(onCleanUp).toHaveBeenCalledWith(expect.objectContaining({ staleMusicCopy: null }))
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

  it('leaves the same-format note out of an overwrite into another format, since the notice above already says what happens', () => {
    renderEditor({ id: 'a', inputPath: '/music/a.wav' }, 'aiff', { overwriteOriginal: true })
    expect(screen.getByTestId('output-name')).toBeInTheDocument()
    expect(screen.queryByTestId('output-name-hint')).toBeNull()
  })

  it('shows only the File Name section when overwriting without loss, since the DJ chose that mode and the convert confirmation already warns', () => {
    renderEditor({ id: 'a', fileName: 'original track 01' }, 'wav', { overwriteOriginal: true })
    expect(screen.getByTestId('output-name')).toBeInTheDocument()
    expect(screen.queryByTestId('overwrite-notice')).toBeNull()
  })

  it('hides Regenerate when overwriting with the pattern applied automatically, since the conversion already renames the file to the name shown', () => {
    renderEditor({ id: 'a', meta: { artist: 'Halo', title: 'Sunrise' } }, 'wav', {
      overwriteOriginal: true,
      autoApplyFilename: true,
      filenameFormat: '{artist} - {title}',
    })
    expect(screen.getByTestId('output-name')).toHaveValue('Halo - Sunrise')
    expect(screen.queryByTestId('regenerate-output-name')).toBeNull()
  })

  // Overwrite is a one-shot pick in the menu, so a track the user sent there by hand
  // keeps going there after a visit to another track, even with Settings saying otherwise.
  it('keeps a remembered Overwrite pick with overwrite off in Settings', () => {
    renderEditor({ id: 'a', inputPath: '/music/a.wav' }, 'mp3', {
      overwriteOriginal: false,
      rememberedPick: { destination: 'overwrite' },
    })
    expect(screen.getByTestId('overwrite-notice')).toBeInTheDocument()
  })

  // The one irreversible case — replacing a lossless master with MP3 — gets the louder
  // warning so the user isn't surprised that the original is gone.
  it('warns about losing the master when overwriting a lossless source with MP3', () => {
    renderEditor({ id: 'a', inputPath: '/music/a.wav' }, 'mp3', {
      overwriteOriginal: true,
      backupPolicy: 'never',
    })
    expect(screen.getByTestId('overwrite-hint')).toHaveTextContent(/master is lost/i)
  })

  // Re-encoding to MP3 changes the audio, so under the default backup policy the master
  // is kept and can be restored from the track. Saying it is gone for good was untrue and
  // pushed users away from a safe action.
  it('says the master is backed up when the backup policy keeps it', () => {
    renderEditor({ id: 'a', inputPath: '/music/a.wav' }, 'mp3', { overwriteOriginal: true })
    expect(screen.getByTestId('overwrite-hint')).not.toHaveTextContent(/master is lost/i)
    expect(screen.getByTestId('overwrite-hint')).toHaveTextContent(/backup/i)
  })

  it('shows no notice when overwriting without losing quality', () => {
    renderEditor({ id: 'a', inputPath: '/music/a.wav' }, 'aiff', { overwriteOriginal: true })
    expect(screen.queryByTestId('overwrite-notice')).toBeNull()
  })

  // Overwrite never forces ALAC over another format's file: the export renders a fresh
  // .m4a and keeps the source (see shared/format). The generic "replaces the source"
  // promise would be a lie there; the notice must say the original is kept instead.
  it('says the original is kept when overwrite mode targets ALAC', () => {
    renderEditor({ id: 'a', inputPath: '/music/a.wav' }, 'alac', { overwriteOriginal: true })
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

// aria-expanded says the Metadata header opens something; aria-controls says what, so a
// screen reader can jump from the header straight into the fields it revealed.
describe('Editor metadata section wiring', () => {
  it('points the Metadata header at the body holding the fields', () => {
    renderEditor({ id: 'a', meta: { title: 'Song' } }, 'wav', { visibleFields: ['title'] })
    const body = screen.getByTestId('field-title').closest('[data-testid="section-body"]')
    expect(body?.id).toBeTruthy()
    const header = document.querySelector(`[aria-controls="${body?.id}"]`)
    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(header).toHaveAccessibleName('Metadata')
  })
})

describe('Editor on a track opened from Serato', () => {
  it('blocks converting it, in place or not, and says Serato would lose the track and its cues', () => {
    renderEditor({ id: 'a', programs: ['serato'] })
    expect(screen.getByTestId('process-btn')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('process-format-toggle')).toBeEnabled()
    expect(screen.getByTestId('process-btn')).toHaveAccessibleDescription(
      'Serato would lose the track and its cues',
    )
  })

  it('does not send the DJ to an empty field when the press is blocked by Serato, since filling it would not help', () => {
    renderEditor({ id: 'a', programs: ['serato'], meta: { artist: '' } }, 'wav', {
      requiredFields: ['artist'],
      visibleFields: ['artist'],
    })
    fireEvent.click(screen.getByTestId('process-btn'))
    expect(screen.getByTestId('field-artist')).not.toHaveFocus()
    expect(screen.getByTestId('process-btn')).toHaveAccessibleDescription(
      'Serato would lose the track and its cues',
    )
  })

  it('leaves converting a rekordbox track as it was', () => {
    renderEditor({ id: 'a', programs: ['rekordbox'] })
    expect(screen.getByTestId('process-btn')).not.toHaveAttribute('aria-disabled')
    expect(screen.getByTestId('process-format-toggle')).toBeEnabled()
  })
})

describe('Editor required-field gate', () => {
  // One track and a selection name what is missing the same way: as a list in the UI
  // language, not as a comma run ("Title, Artist").
  it('names the missing fields of one track as a list', () => {
    renderEditor({ id: 'a', meta: { title: '', artist: '' } }, 'wav', {
      requiredFields: ['title', 'artist'],
    })
    expect(screen.getByTestId('process-btn')).toHaveAccessibleDescription(
      'Missing required fields: Title and Artist',
    )
  })

  // The convert button used to fail late: it stayed enabled with empty required
  // fields and only surfaced the error after the click. Blocking it until the fields
  // are filled turns a dead-end error into clear, upfront guidance; the format menu
  // stays open to use, as it does for a selection, since picking a format converts nothing.
  it('blocks the convert while a required field is empty and keeps the format menu', () => {
    renderEditor({ id: 'a', meta: { artist: '' } }, 'wav', { requiredFields: ['artist'] })
    expect(screen.getByTestId('process-btn')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('process-format-toggle')).toBeEnabled()
  })

  // The blocked button names the gap on its face, so pressing it is the obvious next
  // move: it takes the user to that field instead of doing nothing.
  it('takes a press on the blocked convert to the first empty required field', () => {
    renderEditor({ id: 'a', meta: { artist: '' } }, 'wav', {
      requiredFields: ['artist'],
      visibleFields: ['artist'],
    })
    fireEvent.click(screen.getByTestId('process-btn'))
    expect(screen.getByTestId('field-artist')).toHaveFocus()
  })

  it('enables the convert button once every required field has a value', () => {
    renderEditor({ id: 'a', meta: { artist: 'Alex Ponce' } }, 'wav', {
      requiredFields: ['artist'],
    })
    expect(screen.getByTestId('process-btn')).not.toHaveAttribute('aria-disabled')
  })

  // The disabled button needs a reason: flag the empty required field straight away,
  // not only after a (now impossible) failed convert attempt. It is required, not
  // wrong, so it is announced as required and described, never as an invalid entry.
  it('marks an empty required field before any convert attempt', () => {
    renderEditor({ id: 'a', status: 'idle', meta: { artist: '' } }, 'wav', {
      requiredFields: ['artist'],
      visibleFields: ['artist'],
    })
    const field = screen.getByTestId('field-artist')
    expect(screen.getByTestId('field-required-artist')).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-required', 'true')
    expect(field).toHaveAccessibleDescription('Required: fill it in before converting')
  })
})

describe('Editor Discogs apply', () => {
  const searchResult = { id: 1, title: 'Some Album', cover_image: 'cover.jpg' }
  const release = {
    provider: 'discogs' as const,
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

  // In a DJ tab the results column is dead weight for someone placing cues: folding it hands
  // the width to the editor, and the strip left behind is the way back.
  it('folds the results column into a strip that unfolds it again', async () => {
    withDiscogs()
    const { onFoldResults } = renderEditor({ id: 'a' })
    fireEvent.click(screen.getByTestId('results-fold'))
    expect(onFoldResults).toHaveBeenCalledWith(true)
  })

  it('shows only the strip while folded, and searches nothing behind it', async () => {
    withDiscogs()
    const { onFoldResults } = renderEditor({ id: 'a', query: 'some album' }, 'wav', {
      resultsFolded: true,
    })
    expect(screen.queryByTestId('matches-column')).toBeNull()
    await new Promise((r) => setTimeout(r, 600))
    expect(window.api.search).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('results-unfold'))
    expect(onFoldResults).toHaveBeenCalledWith(false)
  })

  // The magnifier on the strip means "I want to search": it must open the column too, or
  // the click would do nothing visible.
  it('unfolds from the strip magnifier as well', () => {
    withDiscogs()
    const { onFoldResults } = renderEditor({ id: 'a' }, 'wav', { resultsFolded: true })
    fireEvent.click(screen.getByTestId('results-unfold-search'))
    expect(onFoldResults).toHaveBeenCalledWith(false)
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

  // A wrong release applied earlier (often by the sweep) must not leave its label behind
  // when the DJ picks the right one, which carries none.
  it('takes back the label the previously applied release wrote', async () => {
    withDiscogs()
    const { onChange } = renderEditor({
      id: 'a',
      meta: { title: 'Track One', publisher: 'Wrong Records' },
      appliedRelease: { before: { publisher: 'Own Label' }, wrote: { publisher: 'Wrong Records' } },
    })
    await search()
    // The title matches the release, so the search opens it on its own; a click on the row
    // before that lands would collapse it instead, which is what happened under load.
    fireEvent.click((await screen.findAllByTestId('discogs-track'))[0])
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ meta: expect.objectContaining({ publisher: 'Own Label' }) }),
      ),
    )
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
      getRelease: vi.fn<Api['getRelease']>().mockResolvedValue(withImage),
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

  it('reads a row listed before its full read first, so the file keeps its own cover', async () => {
    withImages()
    const read = item({ id: 'a', coverUrl: 'embedded.jpg', embeddedCover: 'embedded.jpg' })
    const readFullTrack = vi.fn(async () => read)
    const { onChange } = renderEditor({ id: 'a', metaPartial: true }, 'wav', { readFullTrack })
    await search()
    fireEvent.click(screen.getByTestId('discogs-result'))
    fireEvent.click((await screen.findAllByTestId('discogs-track'))[0])
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ matched: true })),
    )
    expect(readFullTrack).toHaveBeenCalledWith('a')
    expect(coverSourceOf({ ...read, ...onChange.mock.calls.at(-1)?.[0] })).toEqual({
      coverFromFile: '/music/a.wav',
    })
  })

  it('applies nothing while the row is still partly read, rather than guess the file has no art', async () => {
    withImages()
    const partial = item({ id: 'a', metaPartial: true })
    const readFullTrack = vi.fn(async () => partial)
    const { onChange } = renderEditor({ id: 'a', metaPartial: true }, 'wav', { readFullTrack })
    await search()
    fireEvent.click(screen.getByTestId('discogs-result'))
    fireEvent.click((await screen.findAllByTestId('discogs-track'))[0])
    await waitFor(() => expect(readFullTrack).toHaveBeenCalledWith('a'))
    await act(async () => {})
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ matched: true }))
  })

  // App applies the editor's patch to whatever row is selected when it lands, so a full read
  // that returns after the user moved on must not write this track's release onto the next one.
  it('applies nothing once the user has moved to another track before the full read returns', async () => {
    withImages()
    let finishRead: (track: TrackItem) => void = () => {}
    const readFullTrack = vi.fn(
      () =>
        new Promise<TrackItem | undefined>((resolve) => {
          finishRead = resolve
        }),
    )
    const { onChange, unmount } = renderEditor({ id: 'a', metaPartial: true }, 'wav', {
      readFullTrack,
    })
    await search()
    fireEvent.click(screen.getByTestId('discogs-result'))
    fireEvent.click((await screen.findAllByTestId('discogs-track'))[0])
    await waitFor(() => expect(readFullTrack).toHaveBeenCalledWith('a'))
    unmount()
    await act(async () => finishRead(item({ id: 'a' })))
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ matched: true }))
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
      getRelease: vi.fn<Api['getRelease']>().mockResolvedValue(threeImages),
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

  it('folds a run of cover stepper presses into one undo step, so browsing candidates does not push real edits off the stack', async () => {
    withImages()
    const { onRecordUndo } = renderEditor({
      id: 'a',
      coverUrl: 'embedded.jpg',
      embeddedCover: 'embedded.jpg',
    })
    await search()
    fireEvent.click(screen.getByTestId('discogs-result'))
    await screen.findAllByTestId('discogs-track')
    fireEvent.click(screen.getByTestId('cover-next'))
    fireEvent.click(screen.getByTestId('cover-next'))
    fireEvent.click(screen.getByTestId('cover-prev'))

    expect(onRecordUndo).toHaveBeenCalledTimes(3)
    const groups = onRecordUndo.mock.calls.map(([, opts]) => opts.group)
    expect(groups[0]).toEqual(expect.any(String))
    expect(new Set(groups).size).toBe(1)
  })

  it('gives a stepper run on another opening of the track its own undo step', async () => {
    withImages()
    const first = renderEditor({ id: 'a', coverUrl: 'embedded.jpg', embeddedCover: 'embedded.jpg' })
    await search()
    fireEvent.click(screen.getByTestId('discogs-result'))
    await screen.findAllByTestId('discogs-track')
    fireEvent.click(screen.getByTestId('cover-next'))
    cleanup()
    const second = renderEditor({
      id: 'a',
      coverUrl: 'embedded.jpg',
      embeddedCover: 'embedded.jpg',
    })
    await search()
    fireEvent.click(screen.getByTestId('discogs-result'))
    await screen.findAllByTestId('discogs-track')
    fireEvent.click(screen.getByTestId('cover-next'))

    expect(second.onRecordUndo.mock.calls[0][1].group).not.toBe(
      first.onRecordUndo.mock.calls[0][1].group,
    )
  })

  // A field can commit without a focus event we saw (a menu that keeps the focus on mousedown).
  // That edit belongs to its own track alone; sharing a step with another track's edit would
  // let one ⌘Z take back both, the other one unseen.
  it("keeps a field edit made without a focus event out of another track's undo step", () => {
    const first = renderEditor({ id: 'a', meta: { title: 'One' } }, 'wav', {
      visibleFields: ['title'],
    })
    fireEvent.change(screen.getByTestId('field-title'), { target: { value: 'One typed' } })
    fireEvent.blur(screen.getByTestId('field-title'))
    cleanup()
    const second = renderEditor({ id: 'b', meta: { title: 'Two' } }, 'wav', {
      visibleFields: ['title'],
    })
    fireEvent.change(screen.getByTestId('field-title'), { target: { value: 'Two typed' } })
    fireEvent.blur(screen.getByTestId('field-title'))

    expect(second.onRecordUndo.mock.calls[0][1].group).not.toBe(
      first.onRecordUndo.mock.calls[0][1].group,
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

  function AppliedHarness({
    start,
    onRecordUndo,
  }: {
    start: TrackItem
    onRecordUndo: (ids: string[]) => void
  }) {
    const [track, setTrack] = useState(start)
    return (
      <Editor
        item={track}
        libraryIndex={null}
        searchInputRef={createRef<HTMLInputElement>()}
        onChange={(patch) => setTrack((t) => ({ ...t, ...patch }))}
        onRecordUndo={onRecordUndo}
        onProcess={vi.fn()}
        onAddToAppleMusic={vi.fn()}
        resultsFolded={false}
        onFoldResults={vi.fn()}
        onResultsResizeStart={vi.fn()}
        onResultsFit={vi.fn()}
        onShowLoudnessHelp={vi.fn()}
        onHideEditorHints={vi.fn()}
        onOpenRename={vi.fn()}
        onRegenerateName={vi.fn()}
        onTrimDetectedAll={vi.fn()}
        onCopyFilename={vi.fn()}
        onCopyPath={vi.fn()}
        onSearchWeb={vi.fn()}
        onCopyMeta={vi.fn()}
        onPasteMeta={vi.fn()}
        copiedMetaTitle={null}
        onExportCollection={vi.fn()}
        readFullTrack={async () => undefined}
        filesOpen
      />
    )
  }

  async function applyFirstTrack(start: TrackItem, onRecordUndo = vi.fn()): Promise<void> {
    withDiscogs()
    renderWithQuery(<AppliedHarness start={start} onRecordUndo={onRecordUndo} />, {
      visibleFields: ['title', 'artist'],
      showLoudness: false,
    })
    await search()
    fireEvent.click(screen.getByTestId('discogs-result'))
    fireEvent.click((await screen.findAllByTestId('discogs-track'))[0])
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Track One'))
  }

  it('puts the title a release replaced back from More, so a bad match costs one click', async () => {
    const onRecordUndo = vi.fn()
    await applyFirstTrack(item({ id: 'a', meta: { title: 'My Own Title' } }), onRecordUndo)
    expect(screen.queryByTestId('field-title-previous')).not.toBeInTheDocument()
    onRecordUndo.mockClear()
    openMore()
    fireEvent.click(screen.getByTestId('restore-release-btn'))
    expect(onRecordUndo).toHaveBeenCalledWith(['a'])
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('My Own Title'))
    openMore()
    expect(screen.queryByTestId('restore-release-btn')).not.toBeInTheDocument()
  })

  // "The tags from before" includes the blanks: a wrong match that filled an empty artist
  // would otherwise leave that artist behind with no way to drop it but ⌘Z.
  it('empties again a field the release filled from empty', async () => {
    await applyFirstTrack(item({ id: 'a' }))
    expect(screen.getByTestId('field-artist')).toHaveValue('The Artist')
    openMore()
    fireEvent.click(screen.getByTestId('restore-release-btn'))
    await waitFor(() => expect(screen.getByTestId('field-artist')).toHaveValue(''))
  })

  it('offers no restore once the DJ retypes the field, since the release value is no longer there to replace', () => {
    renderEditor(
      {
        id: 'a',
        meta: { title: 'Typed By Hand' },
        appliedRelease: { before: { title: 'Old' }, wrote: { title: 'Track One' } },
      },
      'wav',
      { visibleFields: ['title'] },
    )
    openMore()
    expect(screen.queryByTestId('restore-release-btn')).not.toBeInTheDocument()
  })
})

describe('Editor track preselection', () => {
  const searchResult = { id: 2, title: 'Some Album', cover_image: 'cover.jpg' }
  const release = {
    provider: 'discogs' as const,
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
      getRelease: vi.fn<Api['getRelease']>().mockResolvedValue(release),
    }
  }

  async function loadTracklist({ autoOpens }: { autoOpens: boolean }): Promise<HTMLElement[]> {
    fireEvent.change(screen.getByTestId('discogs-query'), { target: { value: 'some album' } })
    fireEvent.keyDown(screen.getByTestId('discogs-query'), { key: 'Enter' })
    // A confident match auto-opens its tracklist; a low-confidence one doesn't, so the test
    // says which it expects and only the latter opens the row by hand. Deciding from the
    // row's aria-expanded raced the probe: under load the row rendered collapsed while the
    // probe's open was still queued, the click toggled that queued open shut, and no
    // tracklist ever appeared.
    const result = await screen.findByTestId('discogs-result')
    if (!autoOpens) fireEvent.click(result)
    return screen.findAllByTestId('discogs-track')
  }

  // The file's title rarely matches the Discogs spelling exactly — punctuation and
  // case differ — so an exact compare would highlight nothing. The fuzzy match
  // preselects the right mix from the filename so the user doesn't hunt for it.
  it('preselects the tracklist entry that best matches the file title', async () => {
    withDiscogs()
    renderEditor({ id: 'a', meta: { title: 'track two remix' } })
    const rows = await loadTracklist({ autoOpens: true })
    const remix = rows.find((r) => r.textContent?.includes('Track Two (Remix)'))
    const other = rows.find((r) => r.textContent?.includes('Track One'))
    expect(remix).toHaveAttribute('aria-current', 'true')
    expect(other).not.toHaveAttribute('aria-current')
  })

  // With auto-match on, a confident match applies itself as the release opens. Moving the
  // focus to the title then is the same cue a click gives, but the user may still be
  // typing in the search box: the next keys landed in the title and overwrote it.
  it('leaves the focus in the search box when a confident match applies itself', async () => {
    withDiscogs()
    const { onChange } = renderEditor(
      { id: 'a', meta: { title: 'Track Two (Remix)', artist: 'The Artist' } },
      'wav',
      { autoMatch: true, visibleFields: ['title'] },
    )
    const box = screen.getByTestId('discogs-query')
    box.focus()
    await loadTracklist({ autoOpens: true })
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ matched: true })),
    )
    expect(box).toHaveFocus()
  })

  // A ticked checkbox keeps the focus too, as it did before ⌘Z was let through it: the next
  // Space would tick or untick it, not land in the title.
  it('leaves the focus on a checkbox when a confident match applies itself', async () => {
    withDiscogs()
    const { onChange } = renderEditor(
      { id: 'a', meta: { title: 'Track Two (Remix)', artist: 'The Artist' } },
      'wav',
      { autoMatch: true, visibleFields: ['title'] },
    )
    const box = document.createElement('input')
    box.type = 'checkbox'
    document.body.appendChild(box)
    box.focus()
    await loadTracklist({ autoOpens: true })
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ matched: true })),
    )
    expect(box).toHaveFocus()
    box.remove()
  })

  it('records the track, cover included, before a confident match applies itself, so ⌘Z can take back a write nobody clicked', async () => {
    withDiscogs()
    const { onChange, onRecordUndo } = renderEditor(
      { id: 'a', meta: { title: 'Track Two (Remix)', artist: 'The Artist' } },
      'wav',
      { autoMatch: true, visibleFields: ['title'] },
    )
    await loadTracklist({ autoOpens: true })
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ matched: true })),
    )
    expect(onRecordUndo).toHaveBeenCalledTimes(1)
    expect(onRecordUndo).toHaveBeenCalledWith(['a'], { cover: true })
    expect(onRecordUndo.mock.invocationCallOrder[0]).toBeLessThan(
      onChange.mock.invocationCallOrder.at(-1) ?? 0,
    )
  })

  it('pushes no undo step when opening an already-matched track, since nothing is applied to it', async () => {
    withDiscogs()
    const { onChange, onRecordUndo } = renderEditor(
      { id: 'a', matched: true, meta: { title: 'Track Two (Remix)', artist: 'The Artist' } },
      'wav',
      { autoMatch: true, visibleFields: ['title'] },
    )
    await loadTracklist({ autoOpens: true })
    expect(await screen.findByTestId('track-confidence')).toHaveAttribute('data-confidence', 'high')
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ matched: true }))
    expect(onRecordUndo).not.toHaveBeenCalled()
  })

  // Opening a track the DJ retagged by hand is not an invitation to retag it: the
  // confident match waits for a click like any other suggestion.
  it('never applies a confident match by itself to a track edited by hand', async () => {
    withDiscogs()
    const { onChange } = renderEditor(
      { id: 'a', handEdited: true, meta: { title: 'Track Two (Remix)', artist: 'The Artist' } },
      'wav',
      { autoMatch: true, visibleFields: ['title'] },
    )
    await loadTracklist({ autoOpens: true })
    expect(await screen.findByTestId('track-confidence')).toHaveAttribute('data-confidence', 'high')
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ matched: true }))
  })

  // The guard only keeps the sweep's hands off: the DJ picking a release for a track they
  // edited by hand is a deliberate retag and applies as always.
  it('still applies a release the user picks for a track edited by hand', async () => {
    withDiscogs()
    const { onChange } = renderEditor(
      { id: 'a', handEdited: true, meta: { title: 'Track Two (Remix)', artist: 'The Artist' } },
      'wav',
      { autoMatch: true, visibleFields: ['title'] },
    )
    const rows = await loadTracklist({ autoOpens: true })
    fireEvent.click(rows[0])
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ matched: true })),
    )
  })

  it('still moves the focus to the title when nothing is being typed', async () => {
    withDiscogs()
    const { onChange } = renderEditor(
      { id: 'a', meta: { title: 'Track Two (Remix)', artist: 'The Artist' } },
      'wav',
      { autoMatch: true, visibleFields: ['title'] },
    )
    fireEvent.change(screen.getByTestId('discogs-query'), { target: { value: 'some album' } })
    fireEvent.keyDown(screen.getByTestId('discogs-query'), { key: 'Enter' })
    ;(document.activeElement as HTMLElement | null)?.blur()
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ matched: true })),
    )
    expect(screen.getByTestId('field-title')).toHaveFocus()
  })

  // A confident preselection (exact title, artist agreeing) and a shakier one (a partial
  // match) should not look the same: the badge tells the user whether to trust the
  // highlight or double-check it, which is what makes a batch auto-match safe.
  it('marks an exact-title preselection with an agreeing artist as a confident match', async () => {
    withDiscogs()
    renderEditor({ id: 'a', meta: { title: 'track two remix', artist: 'The Artist' } })
    await loadTracklist({ autoOpens: true })
    expect(await screen.findByTestId('track-confidence')).toHaveAttribute('data-confidence', 'high')
  })

  // An exact title with nothing to corroborate it (no durations, no agreeing artist, no
  // catalog number) is the classic false positive — a same-named track on another act's
  // release — so the badge shows the same 'review' verdict the sweep acts on.
  it('marks an exact-title preselection with no corroborating signal for review', async () => {
    withDiscogs()
    renderEditor({ id: 'a', meta: { title: 'track two remix' } })
    await loadTracklist({ autoOpens: true })
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
    await loadTracklist({ autoOpens: true })
    const badge = await screen.findByTestId('track-confidence')
    expect(badge).toHaveTextContent('')
    // The tooltip names the tier, since the sparkle's colour is all that separates them.
    const tierLabel =
      badge.dataset.confidence === 'high' ? 'editor.matchSuggested' : 'match.toConfirm'
    expect(await hoverForTooltip(badge)).toHaveTextContent(i18n.t(tierLabel))
  })

  it('flags a partial-title preselection for review', async () => {
    withDiscogs()
    renderEditor({ id: 'a', meta: { title: 'track two' } })
    await loadTracklist({ autoOpens: true })
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
    const rows = await loadTracklist({ autoOpens: false })
    const applied = rows.find((r) => r.textContent?.includes('Track One'))
    const other = rows.find((r) => r.textContent?.includes('Track Two (Remix)'))
    // The weak score suppresses the suggestion badge, but the applied mark stays.
    expect(screen.queryByTestId('track-confidence')).toBeNull()
    expect(applied).toHaveAttribute('aria-current', 'true')
    expect(other).not.toHaveAttribute('aria-current')
  })

  it('keeps the applied row marked when the applied title carries the mix name', async () => {
    withDiscogs()
    ;(window as unknown as { api: { getRelease: unknown } }).api.getRelease = vi
      .fn()
      .mockResolvedValue({
        ...release,
        provider: 'beatport',
        tracklist: [
          { position: '1', title: 'Song', mixName: 'Extended Mix', duration: '7:02' },
          { position: '2', title: 'Song', mixName: 'Radio Edit', duration: '3:10' },
        ],
      })
    renderEditor({
      id: 'a',
      duration: 390,
      meta: { title: 'Song (Extended Mix)', trackNumber: '1' },
    })
    const rows = await loadTracklist({ autoOpens: false })
    const applied = rows.find((r) => r.textContent?.includes('Extended Mix'))
    const other = rows.find((r) => r.textContent?.includes('Radio Edit'))
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
    const rows = await loadTracklist({ autoOpens: false })
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
    expect(reveal).toHaveAccessibleName(/^Show in File Explorer/)
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

describe('Editor Apple Music library section', () => {
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
      appleMusicEntryLocation: vi.fn().mockResolvedValue(''),
      appleMusicEntryMeta: vi.fn().mockResolvedValue(null),
      sameFile: vi.fn(async (a: string, b: string) => a === b),
      readTags: vi.fn().mockRejectedValue(new Error('no library copy in this test')),
      readCoverFull: vi.fn().mockResolvedValue(null),
      cancelAnalysis: vi.fn().mockResolvedValue(undefined),
      readDuration: vi.fn().mockResolvedValue(null),
    }
  }

  const owned: AppleMusicIndex = buildLibraryIndex([{ title: 'Strobe', artist: 'deadmau5' }])
  const ownedWithId: AppleMusicIndex = buildLibraryIndex([
    { title: 'Strobe', artist: 'deadmau5', persistentId: '0123456789ABCDEF' },
  ])
  const mp3Copy: TrackProperties = {
    container: 'mp3',
    codec: 'mp3',
    sampleRateHz: 44100,
    bitDepth: null,
    channels: 2,
    bitrateKbps: 320,
    sizeBytes: 9_000_000,
    createdMs: null,
    modifiedMs: null,
    tagFormats: [],
  }

  // The library section exists so a DJ doesn't re-import a song they already own; on macOS it
  // checks the live title/artist against the same library snapshot the list and filter
  // read, so the section can never disagree with the row's in-library state.
  it('flags a track already in the Apple Music library on macOS', () => {
    setApi('darwin')
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav', {
      libraryIndex: owned,
    })
    expect(screen.getByTestId('library-section')).toBeInTheDocument()
    expect(screen.getByTestId('library-row')).toHaveTextContent('Apple Music')
  })

  // With Engine DJ on, the section reads the Engine collection, and its row names it, so the
  // user sees which library the track is in. Not macOS-gated: the Engine database is plain
  // SQLite on every platform.
  it('shows Engine DJ from the Engine collection', async () => {
    const api = window.api as unknown as Record<string, unknown>
    api.dj = djReads({
      engine: {
        collection: async () => [
          { contentId: 'e1', path: '/e/Strobe.wav', title: 'Strobe', artist: 'deadmau5' },
        ],
      },
    })
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav', {
      addToAppleMusic: false,
      addToEngineDj: true,
      libraryIndex: owned,
    })
    expect(await screen.findByTestId('library-row')).toHaveTextContent('Engine DJ')
  })

  function rekordboxWithCopy(copyPath: string): ReturnType<typeof vi.fn> {
    const editPlaylist = vi.fn<ProgramReads['editPlaylist']>().mockResolvedValue({ applied: true })
    const api = window.api as unknown as Record<string, unknown>
    api.properties = vi.fn(async (path: string) => (path === copyPath ? mp3Copy : null))
    // Loudness never answers, so the row stays on Comparing while the DJ ticks.
    api.loudness = vi.fn(() => new Promise(() => {}))
    api.cancelAnalysis = vi.fn().mockResolvedValue(undefined)
    api.dj = djReads({
      rekordbox: {
        available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
        tree: vi
          .fn<ProgramReads['tree']>()
          .mockResolvedValue([{ id: 'p1', name: 'Friday', kind: 'playlist', count: 0 }]),
        membership: vi.fn<ProgramReads['membership']>().mockResolvedValue({}),
        collection: async () => [
          {
            contentId: 'r1',
            path: copyPath,
            title: 'Strobe',
            artist: 'deadmau5',
            durationSec: 300,
          },
        ],
        editPlaylist,
      },
    })
    return editPlaylist
  }

  async function tickFriday(): Promise<void> {
    const field = await screen.findByTestId('playlists-field')
    await waitFor(() => expect(within(field).getByTestId('playlists-summary')).not.toBeDisabled())
    fireEvent.click(within(field).getByTestId('playlists-summary'))
    fireEvent.click(screen.getByTestId('playlists-check-p1'))
  }

  // The DJ ticks a playlist to have the track there in rekordbox now. The copy the section
  // found is the track in rekordbox, so it goes in at once even before the comparison settles.
  it('adds the rekordbox copy to a playlist from the field while the copy is still being compared', async () => {
    const editPlaylist = rekordboxWithCopy('/r/Strobe.aiff')
    const { onChange } = renderEditor(
      { id: 'a', duration: 300, meta: { title: 'Strobe', artist: 'deadmau5' } },
      'wav',
      { addToAppleMusic: false, syncRekordbox: true, visibleFields: ['rekordboxPlaylists'] },
    )
    expect(await screen.findByTestId('library-verdict')).toHaveTextContent('Comparing')
    await tickFriday()
    await waitFor(() =>
      expect(editPlaylist).toHaveBeenCalledWith(
        { kind: 'add', playlistId: 'p1', tracks: [{ paths: ['/r/Strobe.aiff'] }] },
        expect.anything(),
      ),
    )
    expect(onChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ playlists: expect.anything() }),
    )
  })

  // The open file is itself the rekordbox entry: there is no other copy to write, so the pick
  // is staged for the conversion as before.
  it('stages the playlist as today when the only match is the open file itself', async () => {
    const editPlaylist = rekordboxWithCopy('/music/a.wav')
    const { onChange } = renderEditor(
      { id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } },
      'wav',
      { addToAppleMusic: false, syncRekordbox: true, visibleFields: ['rekordboxPlaylists'] },
    )
    expect(await screen.findByTestId('library-row')).toHaveTextContent('rekordbox')
    await tickFriday()
    expect(onChange).toHaveBeenCalledWith({
      playlists: { rekordbox: { targets: [{ id: 'p1', name: 'Friday' }], base: [] } },
    })
    expect(editPlaylist).not.toHaveBeenCalled()
  })

  // Surco only knows the copy through the section; with it hidden the field stages as before.
  it('stages the playlist as today when the library section is hidden', async () => {
    const editPlaylist = rekordboxWithCopy('/r/Strobe.aiff')
    const { onChange } = renderEditor(
      { id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } },
      'wav',
      {
        addToAppleMusic: false,
        syncRekordbox: true,
        visibleFields: ['rekordboxPlaylists'],
        editorSections: DEFAULT_EDITOR_SECTIONS.map((s) =>
          s.id === 'library' ? { ...s, hidden: true } : s,
        ),
      },
    )
    await tickFriday()
    expect(onChange).toHaveBeenCalledWith({
      playlists: { rekordbox: { targets: [{ id: 'p1', name: 'Friday' }], base: [] } },
    })
    expect(editPlaylist).not.toHaveBeenCalled()
  })

  // The complement: a song not found in the snapshot shows nothing, because the editor
  // only speaks about what the track has, never about what it lacks.
  it('shows no section for a track that is not in the library', () => {
    setApi('darwin')
    renderEditor({ id: 'a', meta: { title: 'Unknown', artist: 'Nobody' } }, 'wav', {
      libraryIndex: owned,
    })
    expect(screen.queryByTestId('library-section')).toBeNull()
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
    expect(screen.getByTestId('library-row')).toHaveTextContent('Apple Music')
  })

  // A shown row always says what its copy is: a track already in Music by its own persistent ID
  // has a known copy, so its format is read from where Music keeps it.
  it('names the format of the Music copy a track carries by its own persistent ID', async () => {
    setApi('darwin')
    const api = window.api as unknown as Record<string, unknown>
    api.appleMusicEntryLocation = vi.fn(async (id: string) =>
      id === 'ABCD1234' ? '/Music/Fresh.wav' : '',
    )
    api.properties = vi.fn(async (path: string) =>
      path === '/Music/Fresh.wav'
        ? { ...mp3Copy, container: 'wav', codec: 'pcm_s16le', bitDepth: 16, bitrateKbps: 1411 }
        : null,
    )
    renderEditor(
      { id: 'a', musicPersistentId: 'ABCD1234', meta: { title: 'Fresh', artist: 'New' } },
      'wav',
      { libraryIndex: null },
    )
    expect(await screen.findByTestId('library-row-format')).toHaveTextContent('WAV 16/44.1')
  })

  // Two Music entries match equally, so no copy can be named: the copy is not missing, the
  // library holds it twice, and the row says so with no format or comparison it cannot back.
  it('says how many copies Music holds when it cannot tell which one is this track', async () => {
    setApi('darwin')
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav', {
      libraryIndex: buildLibraryIndex([
        { title: 'Strobe', artist: 'deadmau5', persistentId: '0123456789ABCDEF' },
        { title: 'Strobe', artist: 'deadmau5', persistentId: 'FEDCBA9876543210' },
      ]),
    })
    const row = await screen.findByTestId('library-row')
    const state = within(row).getByTestId('library-row-state')
    expect(state).toHaveAttribute('data-state', 'several')
    expect(state).toHaveAccessibleName('2 copies')
    expect(within(row).queryByTestId('library-row-format')).toBeNull()
    expect(row.tagName).not.toBe('BUTTON')
    expect(screen.queryByTestId('library-verdict')).toBeNull()
  })

  // A matched entry Music gives no ID for cannot be located at all: that copy is not found.
  it('says the Music copy is not found when the matched entry cannot be located', async () => {
    setApi('darwin')
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav', {
      libraryIndex: owned,
    })
    const state = await screen.findByTestId('library-row-state')
    expect(state).toHaveAttribute('data-state', 'missing')
    expect(state).toHaveAccessibleName('Not found')
  })

  // The library owns the track (proven once and pinned) but no entry matches its tags now:
  // there is no copy to reach, so the row says it is not found.
  it('says not found when the library owns the track but no entry matches it, since no copy is reachable', async () => {
    setApi('darwin')
    renderEditor(
      { id: 'a', inLibraryResolved: true, meta: { title: 'Strobe', artist: 'deadmau5' } },
      'wav',
      {
        libraryIndex: buildLibraryIndex([
          { title: 'Other', artist: 'Someone', persistentId: '0123456789ABCDEF' },
        ]),
      },
    )
    const state = await screen.findByTestId('library-row-state')
    expect(state).toHaveAttribute('data-state', 'missing')
    expect(state).toHaveAccessibleName('Not found')
  })

  // Until the snapshot arrives there is no verdict to show, so the section stays hidden
  // rather than guessing — the slot fills once the library has loaded.
  it('hides the section until the snapshot has loaded', () => {
    setApi('darwin')
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav', {
      libraryIndex: null,
    })
    expect(screen.queryByTestId('library-section')).toBeNull()
  })

  // With one copy, its state is every row's state, so it is said once beside the title and
  // the row keeps only the program and the format.
  it('says the verdict beside the title, not on the copy row, when every row shares it', async () => {
    renderWithLibraryCopy({ here: aifLoudness, library: wavLoudness })
    await waitFor(() =>
      expect(screen.getByTestId('library-verdict')).toHaveAccessibleName(
        /^The new one is better\./,
      ),
    )
    expect(screen.getByTestId('library-row')).not.toContainElement(
      screen.getByTestId('library-verdict'),
    )
    expect(screen.queryByTestId('library-row-state')).toBeNull()
  })

  // Folded, the section is one line: the verdict rides the header row, so whether the library
  // holds a better copy still shows while the rows are hidden.
  it('keeps the verdict on the header row while the section is folded', async () => {
    renderWithLibraryCopy({ here: aifLoudness, library: wavLoudness })
    await waitFor(() =>
      expect(screen.getByTestId('library-verdict')).toHaveAccessibleName(
        /^The new one is better\./,
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'In your library' }))
    const headerRow = screen
      .getByRole('button', { name: 'In your library' })
      .closest('h3')?.parentElement
    expect(screen.getByRole('button', { name: 'In your library' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(headerRow).toContainElement(screen.getByTestId('library-verdict'))
    expect(screen.getByTestId('library-verdict')).toHaveAccessibleName(/^The new one is better\./)
  })

  it('shows the library section above the metadata form', () => {
    setApi('darwin')
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav', {
      libraryIndex: owned,
    })
    const section = screen.getByTestId('library-section')
    const metadata = screen.getByRole('button', { name: 'Metadata' })
    expect(section.compareDocumentPosition(metadata) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('separates the metadata form from the library section only when that section shows', () => {
    setApi('darwin')
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav', {
      libraryIndex: owned,
    })
    expect(screen.getByTestId('metadata-block')).toHaveAttribute('data-separated', 'true')
    cleanup()
    renderEditor({ id: 'a', meta: { title: 'Unknown', artist: 'Nobody' } }, 'wav', {
      libraryIndex: owned,
    })
    expect(screen.getByTestId('metadata-block')).toHaveAttribute('data-separated', 'false')
  })

  it('leaves the library section out when it is hidden in the layout', () => {
    setApi('darwin')
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav', {
      libraryIndex: owned,
      editorSections: DEFAULT_EDITOR_SECTIONS.map((s) =>
        s.id === 'library' ? { ...s, hidden: true } : s,
      ),
    })
    expect(screen.queryByTestId('library-section')).toBeNull()
  })

  // The copy's format is said once, on the library's row, beside the library it names.
  it('names the library copy format on the library row', async () => {
    setApi('darwin')
    const api = window.api as unknown as Record<string, unknown>
    api.appleMusicEntryLocation = vi.fn().mockResolvedValue('/Music/Strobe.mp3')
    api.properties = vi.fn(async (path: string) => (path === '/Music/Strobe.mp3' ? mp3Copy : null))
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav', {
      libraryIndex: ownedWithId,
    })
    await waitFor(() => expect(screen.getByTestId('library-row')).toHaveTextContent('MP3 320'))
    expect(screen.getByTestId('library-row')).toHaveTextContent('Apple Music')
    expect(screen.getAllByText('MP3 320')).toHaveLength(1)
  })

  // The swap recipe promises a warning when the file in hand is worse than the library copy.
  // The commonest case is a "lossless" download made from an MP3: the swap would trade the
  // copy for one no better. The verdict turns amber.
  it('says the library copy is better when the file in hand was made from a lossy source', async () => {
    setApi('darwin')
    const api = window.api as unknown as Record<string, unknown>
    api.appleMusicEntryLocation = vi.fn().mockResolvedValue('/Music/Strobe.mp3')
    api.properties = vi.fn(async (path: string) => (path === '/Music/Strobe.mp3' ? mp3Copy : null))
    api.peekAnalysis = vi.fn().mockResolvedValue(null)
    api.spectrogram = vi.fn().mockResolvedValue({
      image: '',
      cutoffHz: 16000,
      sampleRateHz: 44100,
      processed: false,
      hasKnee: true,
    })
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav', {
      libraryIndex: ownedWithId,
      showSpectrum: true,
    })
    await waitFor(() =>
      expect(screen.getByTestId('library-verdict')).toHaveAttribute('data-state', 'library'),
    )
    await waitFor(() => expect(screen.getByTestId('library-row')).toHaveTextContent('MP3 320'))
  })

  it('says nothing about quality when the file in hand is a real upgrade', async () => {
    setApi('darwin')
    const api = window.api as unknown as Record<string, unknown>
    api.appleMusicEntryLocation = vi.fn().mockResolvedValue('/Music/Strobe.mp3')
    api.properties = vi.fn(async (path: string) => (path === '/Music/Strobe.mp3' ? mp3Copy : null))
    api.peekAnalysis = vi.fn().mockResolvedValue(null)
    api.spectrogram = vi.fn().mockResolvedValue({
      image: '',
      cutoffHz: 21500,
      sampleRateHz: 44100,
      processed: false,
      hasKnee: false,
    })
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav', {
      libraryIndex: ownedWithId,
      showSpectrum: true,
    })
    await waitFor(() => expect(api.spectrogram).toHaveBeenCalled())
    expect(screen.queryByTestId('library-verdict')?.getAttribute('data-state')).not.toBe('library')
  })

  // A copy that lives only in iCloud has no file to read, so there is no format to name;
  // the row names only the library rather than guessing.
  it('names no format when the library copy has no file on disk', async () => {
    setApi('darwin')
    const api = window.api as unknown as Record<string, unknown>
    api.appleMusicEntryLocation = vi.fn().mockResolvedValue('')
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav', {
      libraryIndex: ownedWithId,
    })
    await waitFor(() => expect(api.appleMusicEntryLocation).toHaveBeenCalled())
    expect(screen.getByTestId('library-row')).toHaveTextContent('Apple Music')
  })

  // Netzwerk, measured: the AIFF and the library's WAV are one master, and the WAV went
  // through a limiter that pinned 1978 samples at its ceiling.
  const aifLoudness: LoudnessResult = {
    integratedLufs: -12.2,
    truePeakDb: -0.5,
    lra: 6,
    channelBalanceDb: null,
    dcOffset: null,
    crestDb: 13.2,
    noiseFloorDb: null,
    peakCount: 2,
  }
  const wavLoudness: LoudnessResult = {
    ...aifLoudness,
    integratedLufs: -10,
    crestDb: 10.7,
    peakCount: 1978,
  }

  function renderWithLibraryCopy({
    here,
    library,
    pair = Promise.resolve({ correlation: 0.9956, residualDb: -20.5, gainDb: -2.2 }),
    showSpectrum = false,
    libraryLossy = false,
    hereLossy = false,
    herePath = '/music/Strobe.aif',
    platform = 'darwin',
    music = true,
    index = ownedWithId,
    location = '/Music/Strobe.wav',
    hereDuration,
    libraryDuration = null,
    resolved = false,
    meta = { title: 'Strobe', artist: 'deadmau5' },
    libraryProperties,
    libraryGone,
    filesOpen,
    editorSections,
    libraryCopyAction,
  }: {
    here: LoudnessResult | null
    library: LoudnessResult | null
    pair?: Promise<unknown>
    showSpectrum?: boolean
    libraryLossy?: boolean
    hereLossy?: boolean
    herePath?: string
    platform?: string
    music?: boolean
    index?: AppleMusicIndex
    location?: string
    hereDuration?: number
    libraryDuration?: number | null
    resolved?: boolean
    meta?: { title: string; artist: string }
    libraryProperties?: TrackProperties
    libraryGone?: 'missing' | 'unreadable' | 'checking'
    filesOpen?: boolean
    editorSections?: Settings['editorSections']
    libraryCopyAction?: React.ComponentProps<typeof Editor>['libraryCopyAction']
  }): {
    api: Record<string, unknown>
    onProcess: ReturnType<typeof vi.fn>
    onChange: ReturnType<typeof vi.fn>
    onUpdateLibraryCopy: ReturnType<typeof vi.fn>
    setFilesOpen: (filesOpen: boolean) => void
  } {
    setApi(platform)
    const api = window.api as unknown as Record<string, unknown>
    api.appleMusicEntryLocation =
      location === 'pending'
        ? vi.fn(() => new Promise<string>(() => {}))
        : vi.fn().mockResolvedValue(location)
    const readable = libraryProperties ?? {
      ...mp3Copy,
      container: 'wav',
      codec: 'pcm_s16le',
      bitDepth: 16,
      bitrateKbps: 1411,
    }
    api.properties = vi.fn(async (path: string) =>
      (path === location && !libraryGone) || path === herePath ? readable : null,
    )
    api.fileExists =
      libraryGone === 'checking'
        ? vi.fn(() => new Promise<boolean>(() => {}))
        : vi.fn(async (path: string) => !(path === location && libraryGone === 'missing'))
    api.peekAnalysis = vi.fn().mockResolvedValue(null)
    // A lossy source shows as a 16 kHz cutoff with a knee, the mark a transcode leaves.
    api.spectrogram = vi.fn(async (path: string) => {
      const lossy = path === '/Music/Strobe.wav' ? libraryLossy : hereLossy
      return {
        image: '',
        cutoffHz: lossy ? 16000 : 22050,
        sampleRateHz: 44100,
        processed: false,
        hasKnee: lossy,
      }
    })
    api.loudness = vi.fn(async (path: string) => (path === '/Music/Strobe.wav' ? library : here))
    api.fingerprint = vi.fn(async (path: string) => path)
    api.comparePair = vi.fn(() => pair)
    api.readDuration = vi.fn(async (path: string) =>
      path === '/Music/Strobe.wav' ? libraryDuration : (hereDuration ?? null),
    )
    const { onProcess, onChange, onUpdateLibraryCopy, setFilesOpen } = renderEditor(
      {
        id: 'a',
        inputPath: herePath,
        duration: hereDuration,
        inLibraryResolved: resolved,
        meta,
      },
      'wav',
      // The comparison reads in Audio quality, so that section is mounted.
      {
        libraryIndex: index,
        showSpectrum,
        showLoudness: true,
        addToAppleMusic: music,
        filesOpen,
        editorSections,
        libraryCopyAction,
      },
    )
    return { api, onProcess, onChange, onUpdateLibraryCopy, setFilesOpen }
  }

  // An exact match beside a weaker «(Radio Edit)» is no tie: the exact entry is the copy, so
  // the row names its format and weighs it like a single match. Replacing still needs one match.
  it('describes the clearly best Music entry when a weaker variant also matches', async () => {
    const { api } = renderWithLibraryCopy({
      here: aifLoudness,
      library: wavLoudness,
      hereDuration: 372,
      index: buildLibraryIndex([
        { title: 'Strobe', artist: 'deadmau5', durationSec: 372, persistentId: 'AAAA000000000001' },
        {
          title: 'Strobe (Radio Edit)',
          artist: 'deadmau5',
          durationSec: 210,
          persistentId: 'BBBB000000000002',
        },
      ]),
    })
    await waitFor(() =>
      expect(screen.getByTestId('library-verdict')).toHaveAccessibleName(
        /^The new one is better\./,
      ),
    )
    expect(api.appleMusicEntryLocation).toHaveBeenCalledWith('AAAA000000000001')
    expect(api.appleMusicEntryLocation).not.toHaveBeenCalledWith('BBBB000000000002')
    expect(screen.getByTestId('library-row-format')).toHaveTextContent('WAV 16/44.1')
    expect(screen.getByTestId('process-btn')).not.toHaveTextContent(/Replace/)
  })

  // The section answers "do I already have the file I just brought in?". A track opened from a
  // library or DJ program tab already is that library's copy, so the section would only list
  // the copy the user is looking at, and measuring it against itself would cost analysis time.
  it('shows the library section for a track from the Tracks list', async () => {
    renderWithLibraryCopy({ here: aifLoudness, library: wavLoudness, filesOpen: true })
    expect(await screen.findByTestId('library-section')).toBeInTheDocument()
  })

  it('drops the section on leaving the Tracks list and brings it back with one fresh row on returning', async () => {
    const { setFilesOpen } = renderWithLibraryCopy({ here: aifLoudness, library: wavLoudness })
    await waitFor(() =>
      expect(screen.getByTestId('library-verdict')).toHaveAttribute('data-state', 'here'),
    )
    setFilesOpen(false)
    expect(screen.queryByTestId('library-section')).toBeNull()
    setFilesOpen(true)
    await waitFor(() =>
      expect(screen.getByTestId('library-verdict')).toHaveAttribute('data-state', 'here'),
    )
    expect(screen.getAllByTestId('library-row')).toHaveLength(1)
    expect(screen.getByTestId('library-row')).toHaveTextContent('Apple Music')
  })

  // Replacing on convert is not the section: a single Music match within tolerance still has
  // its file looked up in a program tab, so the replace offer works there as it does anywhere.
  it('keeps the replace lookup but shows no section for a single Music match in a program tab', async () => {
    const { api } = renderWithLibraryCopy({
      here: aifLoudness,
      library: wavLoudness,
      filesOpen: false,
    })
    await waitFor(() =>
      expect(api.appleMusicEntryLocation).toHaveBeenCalledWith('0123456789ABCDEF'),
    )
    expect(screen.queryByTestId('library-section')).toBeNull()
  })

  it('shows no library section but measures the replace target for a track opened from a program tab', async () => {
    const { api } = renderWithLibraryCopy({
      here: aifLoudness,
      library: wavLoudness,
      filesOpen: false,
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId('library-section')).toBeNull()
    expect(api.comparePair).toHaveBeenCalled()
    expect(api.fileExists).not.toHaveBeenCalled()
    expect(api.properties).not.toHaveBeenCalledWith('/Music/Strobe.wav')
    expect(api.loudness).toHaveBeenCalledWith('/Music/Strobe.wav', expect.anything())
  })

  it('describes no Apple Music copy in a program tab, since describing it is the section own work', async () => {
    const { api } = renderWithLibraryCopy({
      here: aifLoudness,
      library: wavLoudness,
      hereDuration: 483.4,
      libraryDuration: 447.9,
      resolved: true,
      meta: { title: 'Real love (EXTENDED REMASTERED)', artist: '3 WAYS' },
      index: buildLibraryIndex([
        {
          title: 'Real Love (Extended Version)',
          artist: '3 Ways',
          durationSec: 447.9,
          persistentId: '0123456789ABCDEF',
        },
      ]),
      filesOpen: false,
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(api.appleMusicEntryLocation).not.toHaveBeenCalled()
  })

  // The swap is only worth making if the file in hand is the better copy, and the old
  // format-and-cutoff check calls a limited WAV and a clean AIFF even. The measured verdict
  // says which copy to keep and why, and the numbers behind it are one click away.
  it('says this file is better than the Apple Music copy and opens the numbers', async () => {
    renderWithLibraryCopy({ here: aifLoudness, library: wavLoudness })
    await waitFor(() =>
      expect(screen.getByTestId('library-verdict')).toHaveAccessibleName(
        'The new one is better. The Apple Music copy is 2.2 dB louder, with 1978 samples pinned at its ceiling, the mark of a limiter.',
      ),
    )
    expect(screen.getByTestId('library-verdict')).toHaveAttribute('data-state', 'here')
    expect(screen.queryByTestId('copy-comparison')).toBeNull()
    fireEvent.click(screen.getByTestId('library-row'))
    expect(screen.getByTestId('copy-row-peakCount')).toHaveAttribute('data-decides', 'true')
  })

  // Whether the swap is worth it depends on what the library copy is down to its depth and
  // rate: a WAV 16/44.1 and a WAV 24/96 are not the same copy. The table that weighs the two
  // copies is where that is read, so its heading names the copy in full.
  it('names the library copy in full at the head of the comparison', async () => {
    const { api } = renderWithLibraryCopy({ here: aifLoudness, library: wavLoudness })
    api.properties = vi.fn(async (path: string) =>
      path === '/Music/Strobe.wav'
        ? { ...mp3Copy, container: 'wav', codec: 'pcm_s16le', bitDepth: 16, bitrateKbps: 1411 }
        : null,
    )
    await waitFor(() =>
      expect(screen.getByTestId('library-verdict')).toHaveAccessibleName(
        /^The new one is better\./,
      ),
    )
    fireEvent.click(screen.getByTestId('library-row'))
    expect(
      await screen.findByRole('columnheader', { name: 'Apple Music · WAV 16/44.1' }),
    ).toBeInTheDocument()
  })

  // A track opened straight from the library's own folder is the library's copy: comparing
  // it with itself measures twice to say "same audio" about one file.
  it('shows no verdict when the file in hand is the library copy itself', async () => {
    const { api } = renderWithLibraryCopy({
      here: wavLoudness,
      library: wavLoudness,
      herePath: '/music/strobe.wav'.normalize('NFD'),
    })
    // The library copy's properties are read in the same render the comparison would start.
    await waitFor(() => expect(api.properties).toHaveBeenCalledWith('/Music/Strobe.wav'))
    expect(screen.queryByTestId('library-verdict')).toBeNull()
    expect(api.comparePair).not.toHaveBeenCalled()
  })

  // The row used to be left blank here, which read as a row that failed to load: it says it is
  // the open file, beside the format, and offers no comparison.
  it('says the Apple Music row is the file in hand, with its format, and opens nothing', async () => {
    renderWithLibraryCopy({
      here: wavLoudness,
      library: wavLoudness,
      herePath: '/music/strobe.wav'.normalize('NFD'),
      libraryProperties: mp3Copy,
    })
    const pill = await screen.findByTestId('library-row-state')
    expect(pill).toHaveAccessibleName("It's this file")
    expect(pill).toHaveAttribute('data-state', 'thisFile')
    await waitFor(() =>
      expect(screen.getByTestId('library-row-format')).toHaveTextContent('WAV 320'),
    )
    expect(screen.getByTestId('library-row').tagName).not.toBe('BUTTON')
    expect(screen.queryByTestId('library-verdict')).toBeNull()
  })

  // Until Music has answered where the copy lives the row is not blank either: it says it is
  // comparing, in the place the verdict will take.
  it('says it is comparing on the Apple Music row while the copy location is still being asked', async () => {
    renderWithLibraryCopy({ here: aifLoudness, library: wavLoudness, location: 'pending' })
    expect(await screen.findByTestId('library-verdict')).toHaveAccessibleName('Comparing')
  })

  it('opens the numbers from the library row without folding any section', async () => {
    renderWithLibraryCopy({ here: aifLoudness, library: wavLoudness })
    await waitFor(() =>
      expect(screen.getByTestId('library-verdict')).toHaveAccessibleName(
        /^The new one is better\./,
      ),
    )
    const row = screen.getByTestId('library-row')
    fireEvent.click(row)
    expect(screen.getByRole('button', { name: 'Metadata' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByRole('button', { name: 'In your library' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    const card = screen.getByTestId('copy-comparison')
    expect(row).toHaveAttribute('aria-expanded', 'true')
    const controlled = document.getElementById(row.getAttribute('aria-controls') ?? '')
    expect(controlled).toContainElement(card)
  })

  it('shows no copy line in Audio quality anymore', async () => {
    renderWithLibraryCopy({ here: aifLoudness, library: wavLoudness })
    await waitFor(() =>
      expect(screen.getByTestId('library-verdict')).toHaveAccessibleName(
        /^The new one is better\./,
      ),
    )
    fireEvent.click(screen.getByTestId('library-row'))
    expect(screen.getAllByTestId('copy-comparison')).toHaveLength(1)
    expect(screen.getByTestId('library-section')).toContainElement(
      screen.getByTestId('copy-comparison'),
    )
  })

  // jsdom does not turn Enter or Space on a button into a click (the browser does, for a
  // native button with no interactive ancestor), so the test pins the two things that
  // make the key work: the row takes focus and no other button wraps it.
  it('reaches the library row from the keyboard as a button of its own', async () => {
    renderWithLibraryCopy({ here: aifLoudness, library: wavLoudness })
    await waitFor(() =>
      expect(screen.getByTestId('library-verdict')).toHaveAccessibleName(
        /^The new one is better\./,
      ),
    )
    const pill = screen.getByTestId('library-row')
    pill.focus()
    expect(document.activeElement).toBe(pill)
    expect(pill.tagName).toBe('BUTTON')
    expect(pill.parentElement?.closest('button')).toBeNull()
    fireEvent.click(pill)
    expect(screen.getByTestId('copy-comparison')).toBeInTheDocument()
  })

  // The loudness entry is shared with the Quality section's readout, which measures the
  // open track at 'high' and cancels it when the user browses away. Started at 'low' by the
  // comparison, that readout would join a fetch stuck behind a background sweep.
  it('measures the open track at the editor priority, not the background one', async () => {
    const { api } = renderWithLibraryCopy({ here: aifLoudness, library: wavLoudness })
    await waitFor(() =>
      expect(screen.getByTestId('library-verdict')).toHaveAccessibleName(
        /^The new one is better\./,
      ),
    )
    expect(api.loudness).toHaveBeenCalledWith('/music/Strobe.aif', 'high')
    expect(api.loudness).not.toHaveBeenCalledWith('/music/Strobe.aif', 'low')
  })

  it('says Apple Music has the better copy when this file is the limited one', async () => {
    renderWithLibraryCopy({ here: wavLoudness, library: aifLoudness })
    await waitFor(() =>
      expect(screen.getByTestId('library-verdict')).toHaveAccessibleName(/^The new one is worse/),
    )
    expect(screen.getByTestId('library-verdict')).toHaveAttribute('data-state', 'library')
    expect(screen.getByTestId('library-row')).toHaveTextContent('Apple Music')
  })

  // "Pinned at its ceiling" is a claim the user has to take on trust; the glimpse shows it.
  // The limited copy picks the stretch, so it is always the worse one whichever side it is.
  describe('shows the limiter on the waves when it decided the verdict', () => {
    const glimpse = { worse: [-0.5, 0.5], better: [-0.6, 0.6] }

    it('draws the Apple Music copy as the limited one when this file is better', async () => {
      const { api } = renderWithLibraryCopy({ here: aifLoudness, library: wavLoudness })
      api.limiterGlimpse = vi.fn(async () => glimpse)
      await waitFor(() =>
        expect(screen.getByTestId('library-verdict')).toHaveAccessibleName(
          /^The new one is better\./,
        ),
      )
      fireEvent.click(screen.getByTestId('library-row'))
      expect(await screen.findByTestId('limiter-glimpse')).toBeInTheDocument()
      expect(api.limiterGlimpse).toHaveBeenCalledWith(
        '/Music/Strobe.wav',
        '/music/Strobe.aif',
        44100,
      )
      expect(screen.getByTestId('glimpse-toggle-better')).toHaveTextContent('The new one · AIF')
    })

    it('draws this file as the limited one when Apple Music is better', async () => {
      const { api } = renderWithLibraryCopy({ here: wavLoudness, library: aifLoudness })
      api.limiterGlimpse = vi.fn(async () => glimpse)
      await waitFor(() =>
        expect(screen.getByTestId('library-verdict')).toHaveAccessibleName(/^The new one is worse/),
      )
      fireEvent.click(screen.getByTestId('library-row'))
      expect(await screen.findByTestId('limiter-glimpse')).toBeInTheDocument()
      expect(api.limiterGlimpse).toHaveBeenCalledWith(
        '/music/Strobe.aif',
        '/Music/Strobe.wav',
        44100,
      )
    })

    // A lossy copy is told apart by its spectrum, not by peaks; waves of two different
    // sources would show differences that have nothing to do with the verdict.
    it('draws nothing when the verdict rests on something else', async () => {
      const { api } = renderWithLibraryCopy({
        here: aifLoudness,
        library: wavLoudness,
        libraryLossy: true,
      })
      api.limiterGlimpse = vi.fn(async () => glimpse)
      await waitFor(() =>
        expect(screen.getByTestId('library-verdict')).toHaveAccessibleName(
          /^The new one is better\./,
        ),
      )
      fireEvent.click(screen.getByTestId('library-row'))
      expect(screen.getByTestId('copy-comparison')).toBeInTheDocument()
      expect(screen.queryByTestId('limiter-glimpse')).toBeNull()
      expect(api.limiterGlimpse).not.toHaveBeenCalled()
    })
  })

  // A cutoff or a lossy source is read off the spectrum, so the card shows both copies'
  // spectra on one scale: the claim "cut at 16 kHz" becomes something the user sees.
  describe('shows both spectra when the spectrum decided the verdict', () => {
    it('stacks both copies and marks the Apple Music one as the cut one', async () => {
      renderWithLibraryCopy({ here: aifLoudness, library: wavLoudness, libraryLossy: true })
      await waitFor(() =>
        expect(screen.getByTestId('library-verdict')).toHaveAccessibleName(
          /^The new one is better\./,
        ),
      )
      fireEvent.click(screen.getByTestId('library-row'))
      expect(await screen.findByTestId('spectrum-glimpse')).toBeInTheDocument()
      const here = screen.getByTestId('spectrum-glimpse-here')
      const library = screen.getByTestId('spectrum-glimpse-library')
      expect(here).toHaveTextContent('The new one · AIF')
      expect(library).toHaveTextContent('Apple Music · WAV')
      expect(library.querySelector('[data-testid="spectrum-glimpse-lost"]')).not.toBeNull()
      expect(here.querySelector('[data-testid="spectrum-glimpse-lost"]')).toBeNull()
    })

    // The two pictures sit above the figures whatever decided the verdict, so the reader sees
    // both cutoffs before reading a number; only the copy that lost to its cutoff is tinted.
    it.each([
      ['better', aifLoudness, wavLoudness],
      ['worse', wavLoudness, aifLoudness],
    ] as const)(
      'stacks both spectra above the table when this file is %s',
      async (_state, here, library) => {
        renderWithLibraryCopy({ here, library })
        await waitFor(() => expect(screen.getByTestId('library-verdict')).toBeInTheDocument())
        fireEvent.click(screen.getByTestId('library-row'))
        const spectra = await screen.findByTestId('spectrum-glimpse')
        const table = screen.getByTestId('copy-comparison')
        expect(
          spectra.compareDocumentPosition(table.querySelector('table, [role="table"]') ?? table) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy()
      },
    )

    it('draws the spectra with no cut one marked when a limiter decided it', async () => {
      const { api } = renderWithLibraryCopy({ here: aifLoudness, library: wavLoudness })
      api.limiterGlimpse = vi.fn(async () => ({ worse: [-0.5, 0.5], better: [-0.6, 0.6] }))
      await waitFor(() =>
        expect(screen.getByTestId('library-verdict')).toHaveAccessibleName(
          /^The new one is better\./,
        ),
      )
      fireEvent.click(screen.getByTestId('library-row'))
      expect(await screen.findByTestId('limiter-glimpse')).toBeInTheDocument()
      expect(await screen.findByTestId('spectrum-glimpse')).toBeInTheDocument()
      expect(screen.queryByTestId('spectrum-glimpse-lost')).toBeNull()
    })
  })

  // Until the measured verdict lands, the quick format-and-cutoff check is the only warning
  // there is, so it keeps speaking beside "Comparing…".
  it('keeps the quick warning while the copies are still being measured', async () => {
    renderWithLibraryCopy({
      here: aifLoudness,
      library: wavLoudness,
      pair: new Promise(() => {}),
      showSpectrum: true,
      hereLossy: true,
    })
    await waitFor(() =>
      expect(screen.getByTestId('library-verdict')).toHaveAttribute('data-state', 'library'),
    )
    expect(screen.getByTestId('library-row').tagName).not.toBe('BUTTON')
    expect(screen.getByTestId('library-verdict')).toHaveAccessibleName(/^The new one is worse/)
  })

  // Replacing a better copy with a worse one is the mistake the comparison exists to stop,
  // so the button says the replace goes against the verdict; it still names the action
  // and the press still replaces. Replace is a pick the user remembers; it stamps the Music
  // copy before the convert so the convert writes over it instead of adding a second one.
  // Both lengths are known: a copy whose length is unknown could be another edit.
  it('offers the replace as a deliberate one when Apple Music has the better copy', async () => {
    const { onProcess, onChange } = renderWithLibraryCopy({
      here: wavLoudness,
      library: aifLoudness,
      hereDuration: 300,
      libraryDuration: 300,
      libraryCopyAction: 'replace',
    })
    await waitFor(() =>
      expect(screen.getByTestId('process-btn')).toHaveTextContent(/^Replace anyway$/),
    )
    fireEvent.click(screen.getByTestId('process-btn'))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ replacesPath: '/Music/Strobe.wav' }),
    )
    expect(onProcess).toHaveBeenCalled()
  })

  // Update is the default: it leaves the better copy's audio alone, so nothing warns.
  it('offers to update a better Apple Music copy by default', async () => {
    renderWithLibraryCopy({
      here: wavLoudness,
      library: aifLoudness,
      hereDuration: 300,
      libraryDuration: 300,
    })
    await waitFor(() => expect(screen.getByTestId('process-btn')).toHaveTextContent(/^Update$/))
  })

  it('warns before replacing a better Apple Music copy from a program tab', async () => {
    renderWithLibraryCopy({
      here: wavLoudness,
      library: aifLoudness,
      hereDuration: 300,
      libraryDuration: 300,
      filesOpen: false,
      libraryCopyAction: 'replace',
    })
    await waitFor(() =>
      expect(screen.getByTestId('process-btn')).toHaveTextContent(/^Replace anyway$/),
    )
    expect(screen.queryByTestId('library-section')).toBeNull()
  })

  it('offers to update a better Apple Music copy from a program tab by default', async () => {
    renderWithLibraryCopy({
      here: wavLoudness,
      library: aifLoudness,
      hereDuration: 300,
      libraryDuration: 300,
      filesOpen: false,
    })
    await waitFor(() => expect(screen.getByTestId('process-btn')).toHaveTextContent(/^Update$/))
    expect(screen.queryByTestId('library-section')).toBeNull()
  })

  it('warns before replacing a better Apple Music copy with the library section hidden', async () => {
    renderWithLibraryCopy({
      here: wavLoudness,
      library: aifLoudness,
      hereDuration: 300,
      libraryDuration: 300,
      libraryCopyAction: 'replace',
      editorSections: DEFAULT_EDITOR_SECTIONS.map((s) =>
        s.id === 'library' ? { ...s, hidden: true } : s,
      ),
    })
    await waitFor(() =>
      expect(screen.getByTestId('process-btn')).toHaveTextContent(/^Replace anyway$/),
    )
    expect(screen.queryByTestId('library-section')).toBeNull()
  })

  it('offers to update a better Apple Music copy with the library section hidden by default', async () => {
    renderWithLibraryCopy({
      here: wavLoudness,
      library: aifLoudness,
      hereDuration: 300,
      libraryDuration: 300,
      editorSections: DEFAULT_EDITOR_SECTIONS.map((s) =>
        s.id === 'library' ? { ...s, hidden: true } : s,
      ),
    })
    await waitFor(() => expect(screen.getByTestId('process-btn')).toHaveTextContent(/^Update$/))
    expect(screen.queryByTestId('library-section')).toBeNull()
  })

  // Update rewrites the Music copy's tags; converting the open file instead would leave the
  // library's copy as it was and add nothing the user asked for.
  it('updates the Apple Music copy from the body by default, leaving the open file alone', async () => {
    const { onProcess, onUpdateLibraryCopy } = renderWithLibraryCopy({
      here: aifLoudness,
      library: wavLoudness,
      hereDuration: 300,
      libraryDuration: 300,
    })
    await waitFor(() => {
      expect(screen.getByTestId('process-btn')).toHaveTextContent(/^Update$/)
      expect(screen.getByTestId('process-btn')).not.toHaveAttribute('aria-disabled')
    })
    fireEvent.click(screen.getByTestId('process-btn'))
    expect(onUpdateLibraryCopy).toHaveBeenCalledWith({
      path: '/Music/Strobe.wav',
      program: 'appleMusic',
      musicPersistentId: '0123456789ABCDEF',
    })
    expect(onProcess).not.toHaveBeenCalled()
  })

  // Until the comparison is done the copy may yet be another version, so the press waits.
  it('waits for the comparison before a press updates or replaces', async () => {
    const { onProcess, onUpdateLibraryCopy } = renderWithLibraryCopy({
      here: aifLoudness,
      library: wavLoudness,
      hereDuration: 300,
      libraryDuration: 300,
      pair: new Promise(() => {}),
    })
    await waitFor(() => expect(screen.getByTestId('process-btn')).toHaveTextContent(/^Update$/))
    expect(screen.getByTestId('process-btn')).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByTestId('process-btn'))
    expect(onUpdateLibraryCopy).not.toHaveBeenCalled()
    expect(onProcess).not.toHaveBeenCalled()
  })

  it('says it is still comparing while the copies are being measured', async () => {
    renderWithLibraryCopy({ here: aifLoudness, library: wavLoudness, pair: new Promise(() => {}) })
    const pill = await screen.findByTestId('library-verdict')
    expect(pill).toHaveAccessibleName('Comparing')
  })

  // A copy that could not be measured gives no verdict at all; the section that was there
  // before the comparison existed stays as it was.
  // A copy that could be read but not measured gives no verdict; its row says so instead of
  // staying blank, which read as if Surco had not looked.
  it('says the library copy cannot be measured when its analysis gives nothing', async () => {
    const { api } = renderWithLibraryCopy({ here: aifLoudness, library: null })
    await waitFor(() => expect(api.loudness).toHaveBeenCalledWith('/Music/Strobe.wav', 'low'))
    await waitFor(() =>
      expect(screen.getByTestId('library-row-state')).toHaveAttribute('data-state', 'unmeasurable'),
    )
    expect(screen.getByTestId('library-row-state')).toHaveAccessibleName("Can't be measured")
  })

  // Without any analysis the format and cutoff still say which copy is worse: a lossy file
  // against a lossless library copy is not «can't be measured».
  it('falls back to the format and cutoff check when neither copy can be analysed', async () => {
    renderWithLibraryCopy({ here: null, library: null, hereLossy: true, showSpectrum: true })
    await waitFor(() =>
      expect(screen.getByTestId('library-verdict')).toHaveAttribute('data-state', 'library'),
    )
    expect(screen.getByTestId('library-verdict')).toHaveAccessibleName('The new one is worse')
  })

  // While the file check or the second read of a failed probe is still running the row keeps
  // saying it is comparing instead of going blank for a moment.
  it('says comparing while a failed probe waits for the file check', async () => {
    renderWithLibraryCopy({ here: aifLoudness, library: wavLoudness, libraryGone: 'checking' })
    expect(await screen.findByTestId('library-verdict')).toHaveAccessibleName('Comparing')
  })

  // Two copies that cannot be lined up are not the same master, so the level criteria are
  // skipped; a lossy source still decides on its own.
  it('still gives a verdict when the two copies could not be lined up', async () => {
    const { api } = renderWithLibraryCopy({
      here: aifLoudness,
      library: wavLoudness,
      pair: Promise.resolve(null),
      libraryLossy: true,
    })
    await waitFor(() => expect(api.comparePair).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByTestId('library-verdict')).toHaveAccessibleName(
        /^The new one is better\./,
      ),
    )
  })

  // A 30 s Music copy against a 95 s file: the wider search never runs past its reach, which
  // used to leave the row with no state at all. The lengths alone say it is another version.
  it('says another version from the lengths alone when they are further apart than the search reaches', async () => {
    renderWithLibraryCopy({
      here: aifLoudness,
      library: wavLoudness,
      pair: Promise.resolve(null),
      hereDuration: 95,
      libraryDuration: 30,
    })
    await waitFor(() =>
      expect(screen.getByTestId('library-verdict')).toHaveTextContent('Another version · 0:30'),
    )
  })

  // 3 Ways: two lossless edits, 8:03 and 7:28, that the probe could not line up. Saying
  // nothing hid that the library holds another version; its length is what tells it apart,
  // and opening the row puts both lengths side by side.
  it('says the library holds another version, with its length, when the copies do not line up even searched wider', async () => {
    renderWithLibraryCopy({
      here: aifLoudness,
      library: wavLoudness,
      pair: Promise.resolve({ versionCorrelation: 0.1 }),
      hereDuration: 483.2,
      libraryDuration: 448.4,
    })
    await waitFor(() =>
      expect(screen.getByTestId('library-verdict')).toHaveTextContent('Another version · 7:28'),
    )
    expect(screen.getByTestId('library-verdict')).toHaveAttribute('data-state', 'different')
    fireEvent.click(screen.getByTestId('library-row'))
    const lengths = within(screen.getByTestId('copy-row-duration')).getAllByRole('cell')
    expect(lengths.map((cell) => cell.textContent)).toEqual(['8:03', '7:28'])
  })

  // Music says its copy is another version: a plain Convert must add this file, never write
  // over that entry. Only Update or Replace act on a library copy, and none is offered here.
  it('converts without stamping the Music entry when its copy is another version', async () => {
    const { onChange, onProcess } = renderWithLibraryCopy({
      here: aifLoudness,
      library: wavLoudness,
      pair: Promise.resolve({ versionCorrelation: 0.1 }),
      hereDuration: 483.2,
      libraryDuration: 448.4,
    })
    await waitFor(() =>
      expect(screen.getByTestId('library-verdict')).toHaveAttribute('data-state', 'different'),
    )
    fireEvent.click(screen.getByTestId('process-btn'))
    expect(onProcess).toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ replacesPath: expect.anything() }),
    )
    expect(onChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ musicPersistentId: expect.anything() }),
    )
  })

  // Absolom's Secret, as reported: a FLAC and the library's WAV, both clean, that line up only
  // at 0.92. Nothing makes either better, yet a blank row read as if Surco had not looked:
  // the row says neither is better and opens the figures for the reader to weigh.
  it('says neither copy is better when nothing separates two copies it could not prove one master', async () => {
    const { api } = renderWithLibraryCopy({
      here: aifLoudness,
      library: aifLoudness,
      pair: Promise.resolve({ correlation: 0.9158, residualDb: -7.9, gainDb: -0.1 }),
      hereDuration: 387,
      libraryDuration: 392,
    })
    await waitFor(() => expect(api.comparePair).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByTestId('library-verdict')).toHaveAttribute('data-state', 'even'),
    )
    expect(screen.getByTestId('library-verdict')).toHaveTextContent('Neither is better')
    fireEvent.click(screen.getByTestId('library-row'))
    expect(screen.getByTestId('copy-comparison')).toBeInTheDocument()
    expect(await screen.findByTestId('spectrum-glimpse')).toBeInTheDocument()
  })

  // 3 Ways, as reported: the Music entry runs 35 s shorter, so it is no candidate to replace,
  // yet the section shows it. A row the section shows must say what that copy is, so the
  // comparison runs to describe it; replacing stays off, since that writes to the library.
  it('describes a shown Apple Music copy too far in length to replace, without offering to replace it', async () => {
    const { api } = renderWithLibraryCopy({
      here: aifLoudness,
      library: wavLoudness,
      pair: Promise.resolve({ versionCorrelation: 0.13 }),
      hereDuration: 483.4,
      libraryDuration: 447.9,
      resolved: true,
      meta: { title: 'Real love (EXTENDED REMASTERED)', artist: '3 WAYS' },
      index: buildLibraryIndex([
        {
          title: 'Real Love (Extended Version)',
          artist: '3 Ways',
          durationSec: 447.9,
          persistentId: '0123456789ABCDEF',
        },
      ]),
    })
    await waitFor(() =>
      expect(screen.getByTestId('library-verdict')).toHaveTextContent('Another version · 7:27'),
    )
    expect(api.appleMusicEntryLocation).toHaveBeenCalledWith('0123456789ABCDEF')
    expect(screen.getByTestId('process-btn')).not.toHaveTextContent(/Replace/)
    expect(screen.getByTestId('process-btn')).not.toHaveTextContent(/Update/)
  })

  // Two Music entries match equally: picking one would describe a copy that may not be the
  // one the section means, so the row claims nothing.
  it('describes no copy when the library holds two that match equally', async () => {
    const { api } = renderWithLibraryCopy({
      here: aifLoudness,
      library: wavLoudness,
      index: buildLibraryIndex([
        { title: 'Strobe', artist: 'deadmau5', persistentId: '0123456789ABCDEF' },
        { title: 'Strobe', artist: 'deadmau5', persistentId: 'FEDCBA9876543210' },
      ]),
    })
    await waitFor(() => expect(screen.getByTestId('library-row')).toBeInTheDocument())
    await new Promise((r) => setTimeout(r, 50))
    expect(api.appleMusicEntryLocation).not.toHaveBeenCalled()
    expect(screen.queryByTestId('library-verdict')).toBeNull()
  })

  // One master and nothing measurable between the copies: the row says they are alike and
  // still opens the figures, so the reader can weigh them.
  it('says two copies of one master are alike and opens their figures', async () => {
    renderWithLibraryCopy({ here: aifLoudness, library: aifLoudness })
    await waitFor(() => expect(screen.getByTestId('library-verdict')).toHaveAccessibleName('Alike'))
    fireEvent.click(screen.getByTestId('library-row'))
    expect(screen.getByTestId('copy-row-crest')).toBeInTheDocument()
    expect(screen.queryByTestId('copy-row-duration')).toBeNull()
  })

  // The comparison is with the library's own copy of this track, so it only shows when there
  // is one to measure: Apple Music on, the track found in it, and a file behind the entry.
  // Each case below is the measured verdict's own fixture with one of those taken away.
  describe('only compares when the library holds a copy with a file', () => {
    const settle = () => new Promise((r) => setTimeout(r, 50))

    it('compares when all of them hold', async () => {
      const { api } = renderWithLibraryCopy({ here: aifLoudness, library: wavLoudness })
      await waitFor(() =>
        expect(screen.getByTestId('library-verdict')).toHaveAccessibleName(
          /^The new one is better\./,
        ),
      )
      expect(api.comparePair).toHaveBeenCalled()
    })

    // The Apple Music copy can sit on a drive that is not mounted; its row must not read like
    // a copy that is this very file, nor warn about a copy nobody can reach.
    it.each([
      ['missing', 'No se encuentra', 'Not found'],
      ['unreadable', 'No se puede leer', "Can't be read"],
    ] as const)(
      'says the Apple Music copy is %s when its file cannot be read',
      async (gone, _es, label) => {
        const { api } = renderWithLibraryCopy({
          here: aifLoudness,
          library: wavLoudness,
          hereLossy: true,
          libraryGone: gone,
        })
        await waitFor(() => expect(api.fileExists).toHaveBeenCalledWith('/Music/Strobe.wav'))
        const row = screen.getByTestId('library-row')
        await waitFor(() =>
          expect(within(row).getByTestId('library-row-state')).toHaveTextContent(label),
        )
        expect(within(row).getByTestId('library-row-state')).toHaveAttribute('data-state', gone)
        expect(row.tagName).not.toBe('BUTTON')
        expect(screen.queryByTestId('library-verdict')).toBeNull()
      },
    )

    it('says nothing when adding to Apple Music is off', async () => {
      const { api } = renderWithLibraryCopy({
        here: aifLoudness,
        library: wavLoudness,
        music: false,
      })
      await waitFor(() => expect(api.loudness).toHaveBeenCalledWith('/music/Strobe.aif', 'high'))
      await settle()
      expect(screen.queryByTestId('library-verdict')).toBeNull()
      expect(api.comparePair).not.toHaveBeenCalled()
    })

    it('says nothing when the track is not in Apple Music', async () => {
      const { api } = renderWithLibraryCopy({
        here: aifLoudness,
        library: wavLoudness,
        index: buildLibraryIndex([
          { title: 'Other', artist: 'Someone', persistentId: 'FEDCBA9876543210' },
        ]),
      })
      await settle()
      expect(screen.queryByTestId('library-section')).toBeNull()
      expect(screen.queryByTestId('library-verdict')).toBeNull()
      expect(api.comparePair).not.toHaveBeenCalled()
    })

    // An entry Music lists without a file on disk used to leave a row with nothing to say.
    it('says the Apple Music copy is not found when the entry has no file on disk', async () => {
      const { api } = renderWithLibraryCopy({
        here: aifLoudness,
        library: wavLoudness,
        location: '',
      })
      await waitFor(() => expect(api.appleMusicEntryLocation).toHaveBeenCalled())
      const pill = await screen.findByTestId('library-row-state')
      expect(pill).toHaveAttribute('data-state', 'missing')
      expect(pill).toHaveAccessibleName('Not found')
      expect(api.comparePair).not.toHaveBeenCalled()
    })

    it('says nothing off macOS, where there is no Apple Music', async () => {
      const { api } = renderWithLibraryCopy({
        here: aifLoudness,
        library: wavLoudness,
        platform: 'win32',
      })
      await waitFor(() => expect(api.loudness).toHaveBeenCalledWith('/music/Strobe.aif', 'high'))
      await settle()
      expect(screen.queryByTestId('library-verdict')).toBeNull()
      expect(api.comparePair).not.toHaveBeenCalled()
    })
  })

  // Off macOS there is no Apple Music library, so the section stays hidden rather than
  // making a promise the platform can't keep.
  it('never shows the section off macOS', () => {
    setApi('win32')
    renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav', {
      libraryIndex: owned,
    })
    expect(screen.queryByTestId('library-section')).toBeNull()
  })

  describe('rows for the DJ programs that hold the track', () => {
    type Copy = {
      path: string
      loudness: LoudnessResult | null
      lossy?: boolean
      gone?: 'missing' | 'unreadable'
      durationSec?: number
    }

    let rendered: ReturnType<typeof renderEditor>
    const copyTags = { album: 'Strobe EP', genre: 'Progressive House' }
    const filledPatches = () =>
      rendered.onChange.mock.calls.map(([patch]) => patch).filter((patch) => patch.copyFilled)

    function renderWithPrograms({
      rekordbox,
      traktor,
      serato,
      here = aifLoudness,
      herePath = '/music/Strobe.aif',
      hereDuration,
      syncTraktor = true,
      index,
      filesOpen,
      tags = {},
      pairPending = false,
      identicalPair = false,
      music,
      copyFilled,
      libraryLoading,
      libraryCopyAction,
      musicLocation,
      musicReadable = false,
      musicDurationPending = false,
      sameFile,
    }: {
      rekordbox?: Copy | 'other'
      traktor?: Copy
      serato?: Copy
      here?: LoudnessResult
      herePath?: string
      hereDuration?: number
      syncTraktor?: boolean
      index?: AppleMusicIndex | null
      filesOpen?: boolean
      tags?: Record<string, Partial<TrackMetadata>>
      pairPending?: boolean
      identicalPair?: boolean
      music?: string
      copyFilled?: boolean
      libraryLoading?: boolean
      libraryCopyAction?: React.ComponentProps<typeof Editor>['libraryCopyAction']
      // Music's answer to where its copy lives, held back to test the wait for it.
      musicLocation?: Promise<string>
      // Music's copy at the `music` path reads as a WAV, like the DJ copies.
      musicReadable?: boolean
      musicDurationPending?: boolean
      // Main's answer to whether the open file and a copy are one file on disk.
      sameFile?: (a: string, b: string) => Promise<boolean>
    }): Record<string, unknown> {
      setApi(music ? 'darwin' : 'win32')
      const api = window.api as unknown as Record<string, unknown>
      const copies = [rekordbox, traktor, serato].filter((c): c is Copy => !!c && c !== 'other')
      const copyAt = (path: string) => copies.find((c) => c.path === path)
      const entry = (path: string, title = 'Strobe') => [
        {
          contentId: path,
          path,
          title,
          artist: 'deadmau5',
          durationSec: copyAt(path)?.durationSec,
        },
      ]
      if (music) api.appleMusicEntryLocation = vi.fn(() => musicLocation ?? Promise.resolve(music))
      if (sameFile) api.sameFile = vi.fn(sameFile)
      api.readDuration = vi.fn((path: string) =>
        musicDurationPending && path === music
          ? new Promise<number | null>(() => {})
          : Promise.resolve(
              path === herePath ? (hereDuration ?? null) : (copyAt(path)?.durationSec ?? null),
            ),
      )
      api.readTags = vi.fn(async (path: string) => {
        const copy = tags[path]
        if (!copy) throw new Error('no tags for this path in this test')
        return { ...emptyMetadata(), ...copy }
      })
      api.dj = djReads({
        rekordbox: {
          collection: async () =>
            rekordbox === 'other'
              ? entry('/r/Other.wav', 'Other')
              : rekordbox
                ? entry(rekordbox.path)
                : [],
        },
        traktor: { collection: async () => (traktor ? entry(traktor.path) : []) },
        serato: { collection: async () => (serato ? entry(serato.path) : []) },
      })
      api.peekAnalysis = vi.fn().mockResolvedValue(null)
      api.spectrogram = vi.fn(async (path: string) => {
        const lossy = copyAt(path)?.lossy ?? false
        return {
          image: '',
          cutoffHz: lossy ? 16000 : 22050,
          sampleRateHz: 44100,
          processed: false,
          hasKnee: lossy,
        }
      })
      api.loudness = vi.fn(async (path: string) => {
        const copy = copyAt(path)
        return copy ? copy.loudness : here
      })
      api.fingerprint = vi.fn(async (path: string) => path)
      api.comparePair = pairPending
        ? vi.fn(() => new Promise(() => {}))
        : vi.fn(async () =>
            identicalPair
              ? { correlation: 1, residualDb: -90, gainDb: 0 }
              : { correlation: 0.9956, residualDb: -20.5, gainDb: -2.2 },
          )
      api.fileExists = vi.fn(async (path: string) => copyAt(path)?.gone !== 'missing')
      api.properties = vi.fn(async (path: string) =>
        (copyAt(path) && !copyAt(path)?.gone) ||
        path === herePath ||
        (musicReadable && path === music)
          ? { ...mp3Copy, container: 'wav', codec: 'pcm_s16le', bitDepth: 16, bitrateKbps: 1411 }
          : null,
      )
      rendered = renderEditor(
        {
          id: 'a',
          inputPath: herePath,
          duration: hereDuration,
          copyFilled,
          meta: { title: 'Strobe', artist: 'deadmau5' },
        },
        'wav',
        {
          libraryIndex: index === undefined ? (music ? ownedWithId : owned) : index,
          libraryLoading,
          showLoudness: true,
          addToAppleMusic: !!music,
          syncRekordbox: true,
          syncTraktor,
          syncSerato: !!serato,
          filesOpen,
          libraryCopyAction,
        },
      )
      return api
    }

    it('reads no DJ collection and probes no copy for a track opened from a program tab', async () => {
      const api = renderWithPrograms({
        rekordbox: { path: '/r/Strobe.wav', loudness: wavLoudness },
        traktor: { path: '/t/Strobe.wav', loudness: wavLoudness },
        syncTraktor: true,
        filesOpen: false,
      })
      await new Promise((r) => setTimeout(r, 50))
      expect(screen.queryByTestId('library-section')).toBeNull()
      expect((api.dj as { collection: ReturnType<typeof vi.fn> }).collection).not.toHaveBeenCalled()
      expect(api.comparePair).not.toHaveBeenCalled()
      expect(api.fileExists).not.toHaveBeenCalled()
    })

    it('reads no DJ collection with several tracks selected, since the section speaks about one track', async () => {
      const api = window.api as unknown as Record<string, unknown>
      const dj = djReads({
        rekordbox: {
          collection: async () => [{ contentId: 'r1', path: '/r/A.wav', title: 'A', artist: '' }],
        },
      })
      api.dj = dj
      renderWithQuery(<MultiHarness />, { syncRekordbox: true, syncTraktor: true })
      await new Promise((r) => setTimeout(r, 50))
      expect(dj.collection).not.toHaveBeenCalled()
    })

    it('reads no DJ collection while the section is hidden, since nothing would show what it found', async () => {
      setApi('win32')
      const api = window.api as unknown as Record<string, unknown>
      const dj = djReads({
        rekordbox: {
          collection: async () => [
            { contentId: 'r1', path: '/r/Strobe.wav', title: 'Strobe', artist: 'deadmau5' },
          ],
        },
      })
      api.dj = dj
      renderEditor({ id: 'a', meta: { title: 'Strobe', artist: 'deadmau5' } }, 'wav', {
        syncRekordbox: true,
        editorSections: DEFAULT_EDITOR_SECTIONS.map((s) =>
          s.id === 'library' ? { ...s, hidden: true } : s,
        ),
      })
      await new Promise((r) => setTimeout(r, 50))
      expect(dj.collection).not.toHaveBeenCalled()
    })

    it('shows rekordbox and Traktor rows when both collections hold the track', async () => {
      renderWithPrograms({
        rekordbox: { path: '/r/Strobe.wav', loudness: wavLoudness },
        traktor: { path: '/t/Strobe.wav', loudness: wavLoudness },
      })
      await waitFor(() => expect(screen.getAllByTestId('library-row')).toHaveLength(2))
      const rows = screen.getAllByTestId('library-row')
      expect(rows.map((r) => r.getAttribute('data-row'))).toEqual(['rekordbox', 'traktor'])
      expect(rows[0]).toHaveTextContent('rekordbox')
      expect(rows[1]).toHaveTextContent('Traktor')
    })

    it('shows the rekordbox row without comparison when this file is the rekordbox copy, since there is no second file to weigh', async () => {
      const api = renderWithPrograms({
        rekordbox: { path: '/MUSIC/strobe.aif'.normalize('NFD'), loudness: aifLoudness },
      })
      const row = await screen.findByTestId('library-row')
      await waitFor(() => expect(api.properties).toHaveBeenCalledWith('/music/Strobe.aif'))
      expect(row).toHaveAttribute('data-row', 'rekordbox')
      expect(row.tagName).not.toBe('BUTTON')
      expect(within(row).getByTestId('library-row-state')).toHaveAccessibleName("It's this file")
      expect(within(row).getByTestId('library-row-state')).toHaveAttribute('data-state', 'thisFile')
      const icon = within(row).getByTestId('library-row-icon')
      expect(
        [...row.querySelectorAll('svg')].filter(
          (svg) => !icon.contains(svg) && !svg.closest('[data-testid="library-row-state-sizer"]'),
        ),
      ).toEqual([])
      expect(screen.queryByTestId('library-verdict')).toBeNull()
      expect(api.comparePair).not.toHaveBeenCalled()
    })

    // A copy that is gone showed only its program's name, exactly like the row of a copy that
    // is this very file; it now says it is not found, and the other row keeps its own state.
    it('says a program copy that is not there is not found, unlike the copy that is this file', async () => {
      const api = renderWithPrograms({
        rekordbox: { path: '/music/Strobe.aif', loudness: aifLoudness },
        traktor: { path: '/t/Strobe.wav', loudness: wavLoudness, gone: 'missing' },
      })
      await waitFor(() => expect(screen.getAllByTestId('library-row')).toHaveLength(2))
      await waitFor(() => expect(api.fileExists).toHaveBeenCalledWith('/t/Strobe.wav'))
      await waitFor(() =>
        expect(
          within(screen.getAllByTestId('library-row')[1]).getByTestId('library-row-state'),
        ).toHaveAttribute('data-state', 'missing'),
      )
      const [rekordboxRow, traktorRow] = screen.getAllByTestId('library-row')
      expect(traktorRow.tagName).not.toBe('BUTTON')
      expect(within(traktorRow).queryByTestId('library-row-format')).toBeNull()
      expect(within(rekordboxRow).getByTestId('library-row-state')).toHaveAttribute(
        'data-state',
        'thisFile',
      )
      expect(screen.queryByTestId('library-verdict')).toBeNull()
    })

    // A copy that is there but cannot be probed must not claim to be missing: the DJ would go
    // looking for a drive that is mounted.
    it('says a program copy that is there but cannot be read cannot be read, not that it is missing', async () => {
      renderWithPrograms({
        rekordbox: { path: '/music/Strobe.aif', loudness: aifLoudness },
        traktor: { path: '/t/Strobe.wav', loudness: wavLoudness, gone: 'unreadable' },
      })
      await waitFor(() => expect(screen.getAllByTestId('library-row')).toHaveLength(2))
      await waitFor(() =>
        expect(
          within(screen.getAllByTestId('library-row')[1]).getByTestId('library-row-state'),
        ).toHaveAttribute('data-state', 'unreadable'),
      )
      expect(screen.getAllByTestId('library-row')[1].tagName).not.toBe('BUTTON')
      expect(screen.queryByTestId('library-verdict')).toBeNull()
    })

    it('says there is a better copy when any program holds one, even if another holds a worse one', async () => {
      renderWithPrograms({
        here: wavLoudness,
        rekordbox: { path: '/r/Strobe.wav', loudness: wavLoudness, lossy: true },
        traktor: { path: '/t/Strobe.wav', loudness: aifLoudness },
      })
      await waitFor(() =>
        expect(
          within(screen.getAllByTestId('library-row')[1]).getByTestId('library-row-state'),
        ).toHaveAccessibleName(/^The new one is worse\./),
      )
      const [rekordboxRow, traktorRow] = screen.getAllByTestId('library-row')
      expect(within(rekordboxRow).getByTestId('library-row-state')).toHaveAttribute(
        'data-state',
        'here',
      )
      expect(within(traktorRow).getByTestId('library-row-state')).toHaveAttribute(
        'data-state',
        'library',
      )
      fireEvent.click(screen.getByRole('button', { name: 'In your library' }))
      expect(screen.getByTestId('library-verdict')).toHaveTextContent(/^Better copy in Traktor$/)
    })

    it('names the program in the comparison table', async () => {
      renderWithPrograms({ rekordbox: { path: '/r/Strobe.wav', loudness: wavLoudness } })
      await waitFor(() =>
        expect(screen.getByTestId('library-verdict')).toHaveAccessibleName(
          /^The new one is better\. The rekordbox copy/,
        ),
      )
      fireEvent.click(screen.getByTestId('library-row'))
      expect(
        await screen.findByRole('columnheader', { name: 'rekordbox · WAV 16/44.1' }),
      ).toBeInTheDocument()
      expect(screen.queryByTestId('copy-sentence')).toBeNull()
    })

    it('opens nothing on a program row whose copy is the same audio, since there is no difference to look for', async () => {
      const api = renderWithPrograms({
        here: wavLoudness,
        rekordbox: { path: '/r/Strobe.wav', loudness: wavLoudness },
      })
      api.comparePair = vi.fn(async () => ({ correlation: 1, residualDb: -90, gainDb: 0 }))
      await waitFor(() =>
        expect(screen.getByTestId('library-verdict')).toHaveAccessibleName("It's the same"),
      )
      const row = screen.getByTestId('library-row')
      expect(row.tagName).not.toBe('BUTTON')
      expect(row).not.toHaveAttribute('aria-expanded')
    })

    it('shows no section when no enabled program holds the track and it is not in Apple Music', async () => {
      const api = renderWithPrograms({
        rekordbox: 'other',
        traktor: { path: '/t/Strobe.wav', loudness: wavLoudness },
        syncTraktor: false,
        index: buildLibraryIndex([{ title: 'Other', artist: 'Someone' }]),
      })
      const dj = api.dj as { collection: ReturnType<typeof vi.fn> }
      await waitFor(() => expect(dj.collection).toHaveBeenCalledWith('rekordbox'))
      await new Promise((r) => setTimeout(r, 50))
      expect(screen.queryByTestId('library-section')).toBeNull()
      expect(dj.collection).not.toHaveBeenCalledWith('traktor')
    })

    // With one program row its state goes up to the header, so these tests read the verdict there.
    it('fills the empty fields from the rekordbox copy once it proves to be the same recording', async () => {
      const api = renderWithPrograms({
        rekordbox: { path: '/r/Strobe.wav', loudness: wavLoudness, durationSec: 95 },
        hereDuration: 95,
        tags: { '/r/Strobe.wav': copyTags },
      })
      await waitFor(() =>
        expect(screen.getByTestId('library-verdict')).not.toHaveAttribute(
          'data-state',
          'measuring',
        ),
      )
      await waitFor(() => expect(filledPatches()).toHaveLength(1))
      expect(api.readTags).toHaveBeenCalledWith('/r/Strobe.wav')
      expect(filledPatches()[0].meta).toMatchObject(copyTags)
      expect(rendered.onRecordUndo).toHaveBeenCalledWith(['a'], { cover: false })
    })

    // 95 s here and 30 s in rekordbox: another edit, whose album or genre may not be this file's.
    it('never fills from a DJ copy that is another version, its tags are another edit', async () => {
      const api = renderWithPrograms({
        rekordbox: { path: '/r/Strobe.wav', loudness: wavLoudness, durationSec: 30 },
        hereDuration: 95,
        tags: { '/r/Strobe.wav': copyTags },
      })
      await waitFor(() =>
        expect(screen.getByTestId('library-verdict')).toHaveAttribute('data-state', 'different'),
      )
      await new Promise((r) => setTimeout(r, 50))
      expect(api.readTags).not.toHaveBeenCalledWith('/r/Strobe.wav')
      expect(filledPatches()).toEqual([])
    })

    // The pair probe lines up only the first 91 s, so an extended edit cut from the same master
    // matches it to the sample there: 400 s in rekordbox against 210 s here carries another mix
    // name and ISRC, so its length makes it another version.
    it('never fills from an extended edit whose head matches this file to the sample', async () => {
      const api = renderWithPrograms({
        rekordbox: { path: '/r/Strobe.wav', loudness: wavLoudness, durationSec: 400 },
        hereDuration: 210,
        identicalPair: true,
        tags: { '/r/Strobe.wav': copyTags },
      })
      await waitFor(() =>
        expect(screen.getByTestId('library-verdict')).toHaveAttribute('data-state', 'different'),
      )
      await new Promise((r) => setTimeout(r, 50))
      expect(api.readTags).not.toHaveBeenCalledWith('/r/Strobe.wav')
      expect(filledPatches()).toEqual([])
    })

    const sameRekordboxCopy: Copy = {
      path: '/r/Strobe.wav',
      loudness: wavLoudness,
      durationSec: 95,
    }
    const readyBody = () =>
      waitFor(() => {
        expect(screen.getByTestId('library-verdict')).toHaveAttribute('data-state', 'same')
        expect(screen.getByTestId('process-btn')).not.toHaveAttribute('aria-disabled')
      })

    // A DJ copy is replaced by its file alone: a musicPersistentId would make the convert
    // write over an Apple Music entry the user was never offered.
    it('replaces a copy only rekordbox holds by its path', async () => {
      renderWithPrograms({
        rekordbox: sameRekordboxCopy,
        hereDuration: 95,
        identicalPair: true,
        libraryCopyAction: 'replace',
      })
      await readyBody()
      fireEvent.click(screen.getByTestId('process-btn'))
      expect(rendered.onChange).toHaveBeenCalledWith({ replacesPath: '/r/Strobe.wav' })
      expect(rendered.onChange).not.toHaveBeenCalledWith(
        expect.objectContaining({ musicPersistentId: expect.anything() }),
      )
      expect(rendered.onProcess).toHaveBeenCalled()
      expect(rendered.onChange.mock.invocationCallOrder.at(-1)).toBeLessThan(
        rendered.onProcess.mock.invocationCallOrder[0],
      )
    })

    // Surco can't write an Ogg, so Update can't retag that copy, but the copy is still the
    // track: offering nothing let the body say Convert and add a second entry beside it.
    it('replaces a copy in a format Surco cannot write instead of converting beside it', async () => {
      renderWithPrograms({
        rekordbox: { ...sameRekordboxCopy, path: '/r/Strobe.ogg' },
        hereDuration: 95,
        identicalPair: true,
      })
      await readyBody()
      const body = screen.getByTestId('process-btn')
      expect(body).toHaveTextContent(/^Replace$/)
      fireEvent.click(screen.getByTestId('process-format-toggle'))
      expect(screen.getByTestId('library-copy-update')).toBeDisabled()
      expect(screen.getByTestId('library-copy-replace')).toHaveAttribute('aria-checked', 'true')
      fireEvent.click(body)
      expect(rendered.onUpdateLibraryCopy).not.toHaveBeenCalled()
      expect(rendered.onChange).toHaveBeenCalledWith({ replacesPath: '/r/Strobe.ogg' })
      expect(rendered.onProcess).toHaveBeenCalled()
    })

    it('updates a copy only rekordbox holds', async () => {
      renderWithPrograms({ rekordbox: sameRekordboxCopy, hereDuration: 95, identicalPair: true })
      await readyBody()
      fireEvent.click(screen.getByTestId('process-btn'))
      expect(rendered.onUpdateLibraryCopy).toHaveBeenCalledWith({
        path: '/r/Strobe.wav',
        program: 'rekordbox',
      })
      expect(rendered.onProcess).not.toHaveBeenCalled()
    })

    // Update and Replace act on a file the user does not have open, so the menu names it.
    it('names the copy and its format above the two actions', async () => {
      renderWithPrograms({ rekordbox: sameRekordboxCopy, hereDuration: 95, identicalPair: true })
      await readyBody()
      fireEvent.click(screen.getByTestId('process-format-toggle'))
      expect(screen.getByTestId('library-copy-heading')).toHaveTextContent(
        'rekordbox · WAV 16/44.1',
      )
    })

    it('remembers the action picked from the menu', async () => {
      renderWithPrograms({ rekordbox: sameRekordboxCopy, hereDuration: 95, identicalPair: true })
      await readyBody()
      fireEvent.click(screen.getByTestId('process-format-toggle'))
      fireEvent.click(screen.getByTestId('library-copy-replace'))
      expect(rendered.onLibraryCopyAction).toHaveBeenCalledWith('replace')
    })

    // ⌘⏎ must do what the body says, or the shortcut converts while the button updates.
    it('hands ⌘⏎ the same update the body runs', async () => {
      renderWithPrograms({ rekordbox: sameRekordboxCopy, hereDuration: 95, identicalPair: true })
      await readyBody()
      const run = rendered.onLibraryRunChange.mock.calls.at(-1)?.[0]
      const onStarted = vi.fn()
      run(onStarted)
      expect(rendered.onUpdateLibraryCopy).toHaveBeenCalledWith({
        path: '/r/Strobe.wav',
        program: 'rekordbox',
      })
      expect(onStarted).toHaveBeenCalled()
    })

    // A WAV exported as WAV is edited where it sits, and that update outranks the copy's on the
    // body, so ⌘⏎ keeps converting like the body does.
    it('leaves ⌘⏎ converting when an in-place update outranks the copy on the body', async () => {
      renderWithPrograms({
        rekordbox: sameRekordboxCopy,
        herePath: '/music/Strobe.wav',
        hereDuration: 95,
        identicalPair: true,
      })
      await readyBody()
      expect(rendered.onLibraryRunChange.mock.calls.at(-1)?.[0]).toBeNull()
      fireEvent.click(screen.getByTestId('process-btn'))
      expect(rendered.onUpdateLibraryCopy).not.toHaveBeenCalled()
      expect(rendered.onProcess).toHaveBeenCalled()
    })

    // Replace puts a new file in place of the Serato copy, and Serato keeps its stars only on
    // the file it had: the DJ must read that before pressing. Update keeps that file.
    const sameSeratoCopy: Copy = { path: '/s/Strobe.wav', loudness: wavLoudness, durationSec: 95 }

    it('warns that Serato loses the stars when the body replaces the Serato copy', async () => {
      renderWithPrograms({
        serato: sameSeratoCopy,
        hereDuration: 95,
        identicalPair: true,
        libraryCopyAction: 'replace',
      })
      await readyBody()
      expect(await screen.findByTestId('convert-serato-stars-note')).toBeInTheDocument()
    })

    // The stars warning shows once the body says Replace, so a Replace picked from the menu
    // over the Serato copy must not run before the DJ could read it.
    it('only remembers Replace picked over the Serato copy, leaving the press to the body', async () => {
      renderWithPrograms({ serato: sameSeratoCopy, hereDuration: 95, identicalPair: true })
      await readyBody()
      fireEvent.click(screen.getByTestId('process-format-toggle'))
      fireEvent.click(screen.getByTestId('library-copy-replace'))
      expect(rendered.onLibraryCopyAction).toHaveBeenCalledWith('replace')
      expect(rendered.onProcess).not.toHaveBeenCalled()
      expect(rendered.onChange).not.toHaveBeenCalledWith(
        expect.objectContaining({ replacesPath: '/s/Strobe.wav' }),
      )
    })

    it('replaces at once when Replace is picked over a copy Serato does not hold', async () => {
      renderWithPrograms({ rekordbox: sameRekordboxCopy, hereDuration: 95, identicalPair: true })
      await readyBody()
      fireEvent.click(screen.getByTestId('process-format-toggle'))
      fireEvent.click(screen.getByTestId('library-copy-replace'))
      expect(rendered.onChange).toHaveBeenCalledWith({ replacesPath: '/r/Strobe.wav' })
      expect(rendered.onProcess).toHaveBeenCalled()
    })

    it('says nothing about Serato stars when the body updates the Serato copy', async () => {
      renderWithPrograms({ serato: sameSeratoCopy, hereDuration: 95, identicalPair: true })
      await readyBody()
      expect(screen.getByTestId('process-btn')).toHaveTextContent(/^Update$/)
      await new Promise((r) => setTimeout(r, 50))
      expect(screen.queryByTestId('convert-serato-stars-note')).toBeNull()
    })

    // Music goes first. While it still says where its copy lives, or its copy's length is
    // still being read, the body names the action and waits: offering Convert and then
    // flipping, or acting on the rekordbox copy meanwhile, would update the wrong copy.
    const musicIndex = buildLibraryIndex([
      { title: 'Strobe', artist: 'deadmau5', persistentId: '0123456789ABCDEF', durationSec: 95 },
    ])

    it('waits for Music to say where its copy lives before acting on any copy', async () => {
      let locate: (path: string) => void = () => {}
      renderWithPrograms({
        rekordbox: sameRekordboxCopy,
        hereDuration: 95,
        identicalPair: true,
        music: '/Music/Strobe.wav',
        musicReadable: true,
        index: musicIndex,
        musicLocation: new Promise<string>((resolve) => {
          locate = resolve
        }),
      })
      await waitFor(() => {
        const rekordboxRow = screen
          .getAllByTestId('library-row')
          .find((row) => row.dataset.row === 'rekordbox')
        expect(
          within(rekordboxRow as HTMLElement).getByTestId('library-row-state'),
        ).toHaveAttribute('data-state', 'same')
      })
      expect(screen.getByTestId('process-btn')).toHaveTextContent(/^Update$/)
      expect(screen.getByTestId('process-btn')).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(screen.getByTestId('process-btn'))
      expect(rendered.onUpdateLibraryCopy).not.toHaveBeenCalled()
      expect(rendered.onProcess).not.toHaveBeenCalled()
      await act(async () => locate('/Music/Strobe.wav'))
      await waitFor(() =>
        expect(screen.getByTestId('process-btn')).not.toHaveAttribute('aria-disabled'),
      )
      fireEvent.click(screen.getByTestId('process-btn'))
      expect(rendered.onUpdateLibraryCopy).toHaveBeenCalledWith({
        path: '/Music/Strobe.wav',
        program: 'appleMusic',
        musicPersistentId: '0123456789ABCDEF',
      })
    })

    it("names Music's copy and waits while its length is still being read", async () => {
      renderWithPrograms({
        rekordbox: sameRekordboxCopy,
        hereDuration: 95,
        identicalPair: true,
        music: '/Music/Strobe.wav',
        musicReadable: true,
        musicDurationPending: true,
        index: musicIndex,
      })
      await waitFor(() =>
        expect(screen.getAllByTestId('library-row').map((r) => r.dataset.row)).toEqual([
          'appleMusic',
          'rekordbox',
        ]),
      )
      await waitFor(() => expect(screen.getByTestId('process-btn')).toHaveTextContent(/^Update$/))
      expect(screen.getByTestId('process-btn')).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(screen.getByTestId('process-btn'))
      expect(rendered.onUpdateLibraryCopy).not.toHaveBeenCalled()
      fireEvent.click(screen.getByTestId('process-format-toggle'))
      expect(screen.getByTestId('library-copy-heading')).toHaveTextContent(/^Apple Music · /)
    })

    // A file opened through a symlinked folder is the copy the program indexed under another
    // path: offering to update or replace it would act on the very file, and Replace of
    // itself would offer to trash the source.
    it('offers no library action when the copy is the open file under another path', async () => {
      renderWithPrograms({
        rekordbox: sameRekordboxCopy,
        hereDuration: 95,
        identicalPair: true,
        libraryCopyAction: 'replace',
        sameFile: async (a, b) => a === '/music/Strobe.aif' && b === '/r/Strobe.wav',
      })
      await waitFor(() =>
        expect(screen.getByTestId('library-verdict')).toHaveAttribute('data-state', 'same'),
      )
      await waitFor(() => expect(screen.getByTestId('process-btn')).toHaveTextContent(/^Convert$/))
      fireEvent.click(screen.getByTestId('process-format-toggle'))
      expect(screen.queryByTestId('library-copy-heading')).toBeNull()
      fireEvent.click(screen.getByTestId('process-btn'))
      expect(rendered.onChange).not.toHaveBeenCalledWith(
        expect.objectContaining({ replacesPath: expect.anything() }),
      )
      expect(rendered.onUpdateLibraryCopy).not.toHaveBeenCalled()
      expect(rendered.onProcess).toHaveBeenCalled()
    })

    it('waits for main to say whether the copy is the open file before acting on it', async () => {
      renderWithPrograms({
        rekordbox: sameRekordboxCopy,
        hereDuration: 95,
        identicalPair: true,
        sameFile: () => new Promise<boolean>(() => {}),
      })
      await waitFor(() =>
        expect(screen.getByTestId('library-verdict')).toHaveAttribute('data-state', 'same'),
      )
      expect(screen.getByTestId('process-btn')).toHaveTextContent(/^Update$/)
      expect(screen.getByTestId('process-btn')).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(screen.getByTestId('process-btn'))
      expect(rendered.onUpdateLibraryCopy).not.toHaveBeenCalled()
      expect(rendered.onProcess).not.toHaveBeenCalled()
    })

    // The Music entry that is the open file under another path is retagged by the convert, as
    // when the paths match, instead of a second entry being imported beside it.
    it('names the Music entry that is the open file under another path on a plain convert', async () => {
      renderWithPrograms({
        hereDuration: 95,
        identicalPair: true,
        music: '/Music/Strobe.wav',
        musicReadable: true,
        index: musicIndex,
        sameFile: async (a, b) => a === '/music/Strobe.aif' && b === '/Music/Strobe.wav',
      })
      await waitFor(() => expect(screen.getByTestId('process-btn')).toHaveTextContent(/^Convert$/))
      await new Promise((r) => setTimeout(r, 50))
      expect(screen.getByTestId('process-btn')).toHaveTextContent(/^Convert$/)
      fireEvent.click(screen.getByTestId('process-btn'))
      expect(rendered.onChange).toHaveBeenCalledWith({ musicPersistentId: '0123456789ABCDEF' })
      expect(rendered.onUpdateLibraryCopy).not.toHaveBeenCalled()
      expect(rendered.onProcess).toHaveBeenCalled()
    })

    // Another version is another track: updating its tags or replacing it would lose it.
    it('converts as today when the only copy is another version', async () => {
      renderWithPrograms({
        rekordbox: { path: '/r/Strobe.wav', loudness: wavLoudness, durationSec: 30 },
        hereDuration: 95,
      })
      await waitFor(() =>
        expect(screen.getByTestId('library-verdict')).toHaveAttribute('data-state', 'different'),
      )
      expect(screen.getByTestId('process-btn')).toHaveTextContent(/^Convert$/)
      fireEvent.click(screen.getByTestId('process-format-toggle'))
      expect(screen.queryByTestId('library-copy-heading')).toBeNull()
    })

    it('waits for the comparison before reading a DJ copy', async () => {
      const api = renderWithPrograms({
        rekordbox: { path: '/r/Strobe.wav', loudness: wavLoudness, durationSec: 95 },
        hereDuration: 95,
        tags: { '/r/Strobe.wav': copyTags },
        pairPending: true,
      })
      await waitFor(() =>
        expect(screen.getByTestId('library-verdict')).toHaveAttribute('data-state', 'measuring'),
      )
      await new Promise((r) => setTimeout(r, 50))
      expect(api.readTags).not.toHaveBeenCalledWith('/r/Strobe.wav')
    })

    // A copy Surco just added to a program is still measured, with no length yet, for about
    // a second: saying Convert meanwhile let a press add a duplicate beside it.
    it('names the action and waits while a copy with no length yet is still measured', async () => {
      renderWithPrograms({
        rekordbox: { path: '/r/Strobe.wav', loudness: wavLoudness },
        hereDuration: 95,
        pairPending: true,
      })
      await waitFor(() =>
        expect(screen.getByTestId('library-verdict')).toHaveAttribute('data-state', 'measuring'),
      )
      expect(screen.getByTestId('process-btn')).toHaveTextContent(/^Update$/)
      expect(screen.getByTestId('process-btn')).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(screen.getByTestId('process-btn'))
      expect(rendered.onUpdateLibraryCopy).not.toHaveBeenCalled()
      expect(rendered.onProcess).not.toHaveBeenCalled()
    })

    it('fills from the next program when the first holds another version', async () => {
      const api = renderWithPrograms({
        rekordbox: { path: '/r/Strobe.wav', loudness: wavLoudness, durationSec: 30 },
        traktor: { path: '/t/Strobe.wav', loudness: wavLoudness, durationSec: 95 },
        hereDuration: 95,
        tags: { '/r/Strobe.wav': copyTags, '/t/Strobe.wav': copyTags },
      })
      await waitFor(() => expect(api.readTags).toHaveBeenCalledWith('/t/Strobe.wav'))
      await waitFor(() => expect(filledPatches()).toHaveLength(1))
      expect(api.readTags).not.toHaveBeenCalledWith('/r/Strobe.wav')
    })

    it('lets the Apple Music copy a replacement supersedes fill before a DJ copy', async () => {
      const api = renderWithPrograms({
        rekordbox: { path: '/r/Strobe.wav', loudness: wavLoudness, durationSec: 95 },
        hereDuration: 95,
        music: '/m/old/Strobe.mp3',
        tags: {
          '/m/old/Strobe.mp3': { album: 'From Music' },
          '/r/Strobe.wav': { album: 'From rekordbox' },
        },
      })
      await waitFor(() => expect(filledPatches()).toHaveLength(1))
      expect(filledPatches()[0].meta).toMatchObject({ album: 'From Music' })
      expect(api.readTags).not.toHaveBeenCalledWith('/r/Strobe.wav')
    })

    // Until the Music library lands there is no telling whether it holds a copy to replace,
    // and that copy has the say over a DJ copy.
    it('waits for the Apple Music library before reading a DJ copy', async () => {
      const api = renderWithPrograms({
        rekordbox: { path: '/r/Strobe.wav', loudness: wavLoudness, durationSec: 95 },
        hereDuration: 95,
        music: '/m/old/Strobe.mp3',
        index: null,
        libraryLoading: true,
        tags: { '/r/Strobe.wav': copyTags },
      })
      await waitFor(() =>
        expect(screen.getByTestId('library-verdict')).not.toHaveAttribute(
          'data-state',
          'measuring',
        ),
      )
      await new Promise((r) => setTimeout(r, 50))
      expect(api.readTags).not.toHaveBeenCalledWith('/r/Strobe.wav')
    })

    it('fills from the DJ copy once the Apple Music library loaded without the track', async () => {
      const api = renderWithPrograms({
        rekordbox: { path: '/r/Strobe.wav', loudness: wavLoudness, durationSec: 95 },
        hereDuration: 95,
        music: '/m/old/Strobe.mp3',
        index: buildLibraryIndex([{ title: 'Other', artist: 'Someone' }]),
        tags: { '/r/Strobe.wav': copyTags },
      })
      await waitFor(() => expect(filledPatches()).toHaveLength(1))
      expect(api.readTags).toHaveBeenCalledWith('/r/Strobe.wav')
    })

    // A Music that refused the dump leaves the index null, and so does Settings sending to a
    // folder while this track is sent to Music: App reads no library then, nothing will land.
    it('fills from the DJ copy whenever App is not loading the Apple Music library', async () => {
      const api = renderWithPrograms({
        rekordbox: { path: '/r/Strobe.wav', loudness: wavLoudness, durationSec: 95 },
        hereDuration: 95,
        music: '/m/old/Strobe.mp3',
        index: null,
        libraryLoading: false,
        tags: { '/r/Strobe.wav': copyTags },
      })
      await waitFor(() => expect(filledPatches()).toHaveLength(1))
      expect(api.readTags).toHaveBeenCalledWith('/r/Strobe.wav')
    })

    it('does not fill from a DJ copy when the track was already filled once', async () => {
      const api = renderWithPrograms({
        rekordbox: { path: '/r/Strobe.wav', loudness: wavLoudness, durationSec: 95 },
        hereDuration: 95,
        tags: { '/r/Strobe.wav': copyTags },
        copyFilled: true,
      })
      await waitFor(() =>
        expect(screen.getByTestId('library-verdict')).not.toHaveAttribute(
          'data-state',
          'measuring',
        ),
      )
      await new Promise((r) => setTimeout(r, 50))
      expect(api.readTags).not.toHaveBeenCalledWith('/r/Strobe.wav')
    })
  })
})

describe('Editor Apple Music section via the Discogs suggestion', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  // A track number/title tag the file ships with is often messier than the canonical
  // spelling the user searched for — and the library is keyed by the canonical name. So a
  // confident suggested release bridges a tag the library can't recognise on its own.
  const release = {
    provider: 'discogs' as const,
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
      getRelease: vi.fn<Api['getRelease']>().mockResolvedValue(release),
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
    // The file's own artist tag isn't in the library, so there is no section yet.
    expect(screen.queryByTestId('library-section')).toBeNull()
    fireEvent.change(screen.getByTestId('discogs-query'), { target: { value: 'some album' } })
    const queryInput = screen.getByTestId('discogs-query')
    queryInput.focus()
    fireEvent.keyDown(screen.getByTestId('discogs-query'), { key: 'Enter' })
    const result = await screen.findByTestId('discogs-result')
    if (result.getAttribute('aria-expanded') !== 'true') fireEvent.click(result)
    await screen.findAllByTestId('discogs-track')
    expect(document.activeElement).toBe(queryInput)
    // The release's canonical "The Artist — Track Two (Remix)" is owned, so the section shows
    // even though the file tag never matched on its own.
    expect(await screen.findByTestId('library-row')).toHaveTextContent('Apple Music')
  })

  // The suggestion must not manufacture a false positive: an owned-looking release whose
  // canonical name still isn't in the library leaves the section off.
  it('keeps the section off when the suggestion is not in the library either', async () => {
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
    expect(screen.queryByTestId('library-section')).toBeNull()
  })

  // A track the library lacks shows no section while Discogs is still searching; Discogs may
  // still flip it to owned later.
  it('shows no section while Discogs is still searching for a track the library lacks', async () => {
    setApi()
    let release_: () => void = () => {}
    const gate = new Promise<unknown[]>((res) => {
      release_ = () => res([{ id: 7, title: 'Some Album', cover_image: 'c.jpg' }])
    })
    ;(window as unknown as { api: { search: unknown } }).api.search = vi.fn(() => gate)
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
    fireEvent.keyDown(screen.getByTestId('discogs-query'), { key: 'Enter' })
    await waitFor(() => expect(window.api.search).toHaveBeenCalled())
    expect(screen.queryByTestId('library-section')).toBeNull()
    release_()
  })

  // Once the search settles with no owning match, the section stays off.
  it('stays off once the search settles without an owning match', async () => {
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
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId('library-section')).toBeNull()
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
      expect.objectContaining({
        meta: expect.objectContaining({ title: 'Pepito de los palotes2025' }),
      }),
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
    // no-op for the row, the format button and the ⌘K command alike.
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
    openMore()
    fireEvent.click(screen.getByTestId('apply-title-format-btn'))
    expect(onApplyTitleFormat).toHaveBeenCalledOnce()
  })

  // djotas formats nearly every title, and two clicks through the header ⋯ were too slow:
  // the format button sits inside the title box itself, one click away, beside what it rewrites.
  it('triggers the title-format pass from the format button inside the title field', () => {
    const { onApplyTitleFormat } = renderEditor(
      { id: 't1', meta: { title: 'Action (Base)', trackNumber: 'B2' } },
      'wav',
      { visibleFields: ['title', 'trackNumber'], titleFormat: '({trackNumber}) {title}' },
    )
    fireEvent.click(screen.getByTestId('field-format-title'))
    expect(onApplyTitleFormat).toHaveBeenCalledOnce()
  })

  it('keeps the title format button in place but off once the title already wears the format', () => {
    // Switching tracks must not make the button blink in and out; off says "nothing to do".
    renderEditor({ id: 't1', meta: { title: '(B2) Action (Base)', trackNumber: 'B2' } }, 'wav', {
      visibleFields: ['title', 'trackNumber'],
      titleFormat: '({trackNumber}) {title}',
    })
    expect(screen.getByTestId('field-format-title')).toBeDisabled()
  })

  it('leaves the title format button on when a pattern field is empty, so the click can say which', () => {
    // A dead button would hide the reason; the pass's notice names the missing field.
    renderEditor({ id: 't1', meta: { title: 'Action (Base)' } }, 'wav', {
      visibleFields: ['title', 'trackNumber'],
      titleFormat: '({trackNumber}) {title}',
    })
    expect(screen.getByTestId('field-format-title')).toBeEnabled()
  })

  it('turns the title format button off while the title is empty, whatever else is missing', () => {
    // An empty title has nothing to format; a lit button there promised an action that can only
    // fail, and its notice would blame the empty track number instead of the empty title.
    renderEditor({ id: 't1', meta: { title: '' } }, 'wav', {
      visibleFields: ['title', 'trackNumber'],
      titleFormat: '({trackNumber}) {title}',
    })
    expect(screen.getByTestId('field-format-title')).toBeDisabled()
  })

  it('shows no title format button when no format is configured', () => {
    renderEditor({ id: 't1', meta: { title: 'Action (Base)' } }, 'wav', {
      visibleFields: ['title'],
    })
    expect(screen.queryByTestId('field-format-title')).toBeNull()
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
  // When a format filter is active (Settings → Sources), the Discogs column flags it with a
  // discreet funnel icon, so a thinned or empty result list reads as the filter at work
  // rather than a broken search — without a line of text repeating a setting the user chose.
  it('flags an active format filter with the funnel control, naming the formats on hover', async () => {
    renderEditor({ id: 'a' }, 'wav', { discogsFormats: ['Vinyl', 'CD'] })
    const filter = screen.getByTestId('discogs-format-filter')
    expect(filter).toBeInTheDocument()
    // The formats live in the themed tooltip, surfaced on hover, not as always-on text.
    const tip = await hoverForTooltip(filter)
    expect(tip).toHaveTextContent('Vinyl')
    expect(tip).toHaveTextContent('CD')
  })

  // The filter is a Settings preference, so the control takes the user to where it's
  // changed rather than clearing it from under them.
  it('opens Settings → Sources when the filter control is clicked', () => {
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
      expect(within(screen.getByTestId(id)).getByTestId('section-maximize')).toBeInTheDocument()
    }
    // The File name section draws no wave, so it never grows the maximize toggle.
    expect(
      within(screen.getByTestId('editor-output-name')).queryByTestId('section-maximize'),
    ).toBeNull()
  })
})

describe('Editor maximized section motion', () => {
  type FakeAnimation = { currentTime: number; cancel: () => void; onfinish: (() => void) | null }
  let animations: {
    el: Element
    frames: Keyframe[]
    options: KeyframeAnimationOptions
    anim: FakeAnimation
  }[]
  beforeEach(() => {
    animations = []
    Object.assign((window as unknown as { api: object }).api, { cancelAnalysis: vi.fn() })
    HTMLElement.prototype.animate = function (frames, options) {
      const anim: FakeAnimation = { currentTime: 100, cancel: vi.fn(), onfinish: null }
      animations.push({
        el: this,
        frames: frames as Keyframe[],
        options: options as KeyframeAnimationOptions,
        anim,
      })
      return anim as unknown as Animation
    }
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return this.parentElement?.dataset.testid === 'editor-scroll' &&
        this.querySelector('[data-section-header="trim"]')
        ? new DOMRect(512, 384, 256, 96)
        : new DOMRect(0, 0, 0, 0)
    })
    clientArea(1024, 768)
  })
  const clientArea = (width: number, height: number): void => {
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return this === document.documentElement ? width : 0
    })
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
      return this === document.documentElement ? height : 0
    })
  }
  afterEach(() => {
    delete (HTMLElement.prototype as { animate?: unknown }).animate
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const maximizeTrim = (): HTMLElement => {
    fireEvent.click(within(screen.getByTestId('editor-trim')).getByTestId('section-maximize'))
    return screen.getByTestId('section-maximized-overlay')
  }

  const SECTION_FRAME = {
    transform: 'translate(512px, 384px) scale(0.25)',
    clipPath: 'inset(0px 0px 384px 0px)',
    opacity: 0,
  }
  const FULL_FRAME = { transform: 'none', clipPath: 'inset(0px 0px 0px 0px)', opacity: 1 }
  const inColumn = (): HTMLElement[] =>
    within(screen.getByTestId('editor-scroll')).queryAllByTestId('editor-trim')

  it('grows the overlay out of the section the DJ maximized, so the full view keeps its place', () => {
    renderEditor({ id: 'a' })
    const overlay = maximizeTrim()
    expect(animations).toHaveLength(1)
    const [{ el, frames, options }] = animations
    expect(el).toBe(overlay)
    expect(frames).toEqual([SECTION_FRAME, FULL_FRAME])
    expect(options).toMatchObject({ duration: 240, easing: 'cubic-bezier(0.2, 0, 0, 1)' })
  })

  it('measures the area the overlay covers and not the window, so a classic Windows scrollbar does not throw the crop off', () => {
    clientArea(1000, 750)
    renderEditor({ id: 'a' })
    maximizeTrim()
    expect(animations[0].frames[0]).toEqual({
      transform: 'translate(512px, 384px) scale(0.256)',
      clipPath: 'inset(0px 0px 375px 0px)',
      opacity: 0,
    })
  })

  it('scales the text evenly and crops the rest, so nothing reads squashed on the way', () => {
    renderEditor({ id: 'a' })
    maximizeTrim()
    expect(animations[0].frames[0].transform).toMatch(/scale\([\d.]+\)$/)
  })

  it('carries the section back into its place and only then returns it to the column', () => {
    renderEditor({ id: 'a' })
    const overlay = maximizeTrim()
    act(() => animations[0].anim.onfinish?.())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByTestId('section-maximized-overlay')).toBe(overlay)
    expect(within(overlay).getByTestId('editor-trim')).toBeInTheDocument()
    expect(inColumn()).toHaveLength(0)
    expect(screen.getAllByTestId('editor-trim')).toHaveLength(1)
    const exit = animations[1]
    expect(exit.frames).toEqual([FULL_FRAME, SECTION_FRAME])
    expect(exit.options).toMatchObject({ duration: 240 })
    act(() => exit.anim.onfinish?.())
    expect(screen.queryByTestId('section-maximized-overlay')).toBeNull()
    expect(inColumn()).toHaveLength(1)
    expect(screen.getAllByTestId('editor-trim')).toHaveLength(1)
  })

  it('turns back from wherever it is when the DJ changes their mind mid-way', () => {
    renderEditor({ id: 'a' })
    const overlay = maximizeTrim()
    overlay.style.transform = 'matrix(0.6, 0, 0, 0.6, 200, 150)'
    overlay.style.opacity = '0.5'
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(animations[0].anim.cancel).toHaveBeenCalled()
    expect(animations[1].frames[0]).toMatchObject({
      transform: 'matrix(0.6, 0, 0, 0.6, 200, 150)',
      opacity: '0.5',
    })
    expect(animations[1].options).toMatchObject({ duration: 100 })
    const section = within(overlay).getByTestId('editor-trim')
    fireEvent.click(within(section).getByTestId('section-maximize'))
    expect(animations[1].anim.cancel).toHaveBeenCalled()
    expect(animations[2].frames[1]).toEqual(FULL_FRAME)
    expect(screen.getByTestId('section-maximized-overlay')).toBe(overlay)
    expect(within(overlay).getByTestId('editor-trim')).toBe(section)
    expect(inColumn()).toHaveLength(0)
  })

  it("opens another section at its top rather than at the last one's scroll", () => {
    renderEditor({ id: 'a' })
    const overlay = maximizeTrim()
    act(() => animations[0].anim.onfinish?.())
    fireEvent.click(within(screen.getByTestId('editor-declick')).getByTestId('section-maximize'))
    const next = screen.getByTestId('section-maximized-overlay')
    expect(within(next).getByTestId('editor-declick')).toBeInTheDocument()
    expect(next).not.toBe(overlay)
  })

  it('stops a running animation when the editor goes away', () => {
    renderEditor({ id: 'a' })
    maximizeTrim()
    cleanup()
    expect(animations[0].anim.cancel).toHaveBeenCalled()
  })

  it('cuts straight in and out when the system asks for less motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    renderEditor({ id: 'a' })
    maximizeTrim()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(animations).toHaveLength(0)
    expect(screen.queryByTestId('section-maximized-overlay')).toBeNull()
  })

  it('does not replay the entrance when the next track opens already maximized', () => {
    renderEditor({ id: 'a' })
    maximizeTrim()
    cleanup()
    renderEditor({ id: 'b' })
    expect(screen.getByTestId('section-maximized-overlay')).toBeInTheDocument()
    expect(animations).toHaveLength(1)
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

  // A reordered list can split one phase into several runs (an audio section moved up
  // above the metadata ones leaves the rest of the audio group below them). Each run
  // opens its own heading, so the headings must not collide on a per-group key — React
  // drops or duplicates same-key siblings, and the second run's heading is the one at risk.
  it('labels every run of a phase when the order splits that phase in two', () => {
    const errors: unknown[][] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args)
    })
    renderEditor({ id: 'a' }, 'wav', {
      editorSections: [
        { id: 'form', open: true },
        { id: 'normalize', open: false },
        { id: 'quality', open: false },
        { id: 'properties', open: false },
        { id: 'trim', open: false },
        { id: 'declick', open: false },
        { id: 'output', open: false },
      ],
    })
    const audio = screen.getAllByTestId('editor-group-audio')
    expect(audio).toHaveLength(2)
    const normalize = screen.getByTestId('editor-normalize')
    const trim = screen.getByTestId('editor-trim')
    expect(
      audio[0].compareDocumentPosition(normalize) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(audio[1].compareDocumentPosition(trim) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    spy.mockRestore()
    expect(errors.flat().join(' ')).not.toContain('same key')
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

describe('Discogs token tip', () => {
  it('asks for a Discogs token once the shared limit stops a search, and only without one', async () => {
    const api = (window as unknown as { api: Record<string, unknown> }).api
    api.search = vi.fn(async () => {
      throw new Error("Error invoking remote method 'search': Error: SURCO_ERR:discogsRateLimit")
    })
    renderEditor({ id: 'a', query: 'artist song' }, 'wav', { discogsToken: 'mine' })
    await screen.findByTestId('discogs-wait')
    expect(screen.queryByTestId('discogs-token-tip')).not.toBeInTheDocument()
    cleanup()
    renderEditor({ id: 'a', query: 'artist song' }, 'wav', { discogsToken: '' })
    expect(await screen.findByTestId('discogs-token-tip')).toBeInTheDocument()
  })
})

describe('Editor convert notes from the measured spectrum', () => {
  function renderMeasured(spectrum: Record<string, unknown>): void {
    ;(window as unknown as { api: Record<string, unknown> }).api.spectrogram = vi.fn(async () => ({
      image: '',
      sampleRateHz: 44100,
      processed: false,
      ...spectrum,
    }))
    renderEditor({ id: 'a', inputPath: '/music/a.flac', fileName: 'a.flac' }, 'aiff', {
      showSpectrum: true,
    })
  }

  it('warns that a lossless file measured as a transcode stays lossy in a lossless format', async () => {
    renderMeasured({ cutoffHz: 16000, hasKnee: true })
    expect(await screen.findByTestId('convert-lossy-note')).toHaveTextContent(
      i18n.t('editor.lossyToLossless', { format: 'AIFF' }),
    )
  })

  it('warns that a file measured as damaged makes a damaged copy', async () => {
    renderMeasured({ cutoffHz: 21000, damaged: true })
    expect(await screen.findByTestId('convert-damaged-note')).toHaveTextContent(
      i18n.t('editor.damagedSource'),
    )
  })
})

describe('Editor replacing a library copy', () => {
  const libraryIndex = buildLibraryIndex([
    { title: 'Your Love (Power Love Mix)', artist: '2 Shy', persistentId: '0123456789ABCDEF' },
  ])

  beforeEach(() => {
    Object.assign(window.api, {
      platform: 'darwin',
      appleMusicEntryLocation: vi.fn().mockResolvedValue('/music/old/your-love.mp3'),
      readTags: vi.fn<Api['readTags']>().mockResolvedValue({
        ...emptyMetadata(),
        title: 'Your Love (Power Love Mix)',
        artist: '2 Shy',
        album: 'Your Love',
        genre: 'Euro House',
      }),
    })
  })

  it('fills the empty fields from the copy it replaces, so the DJ can update straight away', async () => {
    const { onChange, onRecordUndo } = renderEditor(
      {
        id: 'a',
        inputPath: '/music/new/your-love.aiff',
        fileName: 'your-love.aiff',
        meta: { title: 'Your Love (Power Love Mix)', artist: '2 Shy' },
      },
      'aiff',
      { libraryIndex, addToAppleMusic: true },
    )
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ copyFilled: true })),
    )
    expect(window.api.readTags).toHaveBeenCalledWith('/music/old/your-love.mp3')
    const patch = onChange.mock.calls.find(([p]) => p.copyFilled)?.[0]
    expect(patch.meta).toMatchObject({ album: 'Your Love', genre: 'Euro House' })
    expect(onRecordUndo).toHaveBeenCalledWith(['a'], { cover: false })
  })

  const lengthIndex = buildLibraryIndex([
    {
      title: 'Your Love (Power Love Mix)',
      artist: '2 Shy',
      persistentId: '0123456789ABCDEF',
      durationSec: 300,
    },
  ])

  it('fills from the copy when its length confirms it is the same recording', async () => {
    const { onChange } = renderEditor(
      {
        id: 'a',
        inputPath: '/music/new/your-love.aiff',
        fileName: 'your-love.aiff',
        duration: 300,
        meta: { title: 'Your Love (Power Love Mix)', artist: '2 Shy' },
      },
      'aiff',
      { libraryIndex: lengthIndex, addToAppleMusic: true },
    )
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ copyFilled: true })),
    )
    expect(window.api.readTags).toHaveBeenCalledWith('/music/old/your-love.mp3')
  })

  // The 35 s gap makes the library entry another version, not a replace target: its tags would not be this file's.
  it('never fills from a copy the section only describes, since another version has other tags', async () => {
    const { onChange, onRecordUndo } = renderEditor(
      {
        id: 'a',
        inputPath: '/music/new/your-love.aiff',
        fileName: 'your-love.aiff',
        duration: 335,
        inLibraryResolved: true,
        meta: { title: 'Your Love (Radio Edit)', artist: '2 Shy' },
      },
      'aiff',
      { libraryIndex: lengthIndex, addToAppleMusic: true },
    )
    await waitFor(() =>
      expect(window.api.properties).toHaveBeenCalledWith('/music/old/your-love.mp3'),
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(window.api.readTags).not.toHaveBeenCalledWith('/music/old/your-love.mp3')
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ copyFilled: true }))
    expect(onRecordUndo).not.toHaveBeenCalled()
  })
})

// App keys the editor per track and the auto-match sweep skips every row it believes is
// under edit. Switching tracks with a field focused removes that field without a blur, so
// the editor must hand the guard back as it goes, or the old track never gets matched.
describe('the under-edit guard across a track switch', () => {
  function Host({
    id,
    focusTitle,
    editing,
  }: {
    id: string
    focusTitle?: boolean
    editing: { current: readonly string[] }
  }) {
    useLayoutEffect(() => {
      if (focusTitle) screen.getByTestId('field-title').focus()
    }, [focusTitle])
    return (
      <Editor
        key={id}
        item={item({ id })}
        libraryIndex={null}
        searchInputRef={createRef<HTMLInputElement>()}
        onChange={vi.fn()}
        onProcess={vi.fn()}
        onAddToAppleMusic={vi.fn()}
        resultsFolded={false}
        onFoldResults={vi.fn()}
        onResultsResizeStart={vi.fn()}
        onResultsFit={vi.fn()}
        onShowLoudnessHelp={vi.fn()}
        onHideEditorHints={vi.fn()}
        onOpenRename={vi.fn()}
        onRegenerateName={vi.fn()}
        onTrimDetectedAll={vi.fn()}
        onCopyFilename={vi.fn()}
        onCopyPath={vi.fn()}
        onSearchWeb={vi.fn()}
        onCopyMeta={vi.fn()}
        onPasteMeta={vi.fn()}
        copiedMetaTitle={null}
        onExportCollection={vi.fn()}
        readFullTrack={async () => undefined}
        filesOpen
        onFieldFocusChange={(ids) => {
          editing.current = ids
        }}
      />
    )
  }

  it('releases the old track when the editor moves on with one of its fields focused', () => {
    const editing: { current: readonly string[] } = { current: [] }
    const { rerenderUi } = renderWithQuery(<Host id="a" editing={editing} />, {
      showLoudness: false,
    })
    act(() => screen.getByTestId('field-title').focus())
    expect(editing.current).toEqual(['a'])
    rerenderUi(<Host id="b" editing={editing} />)
    expect(editing.current).toEqual([])
  })

  it('keeps the new track under edit when its field takes focus as the editor switches', () => {
    const editing: { current: readonly string[] } = { current: [] }
    const { rerenderUi } = renderWithQuery(<Host id="a" editing={editing} />, {
      showLoudness: false,
    })
    act(() => screen.getByTestId('field-title').focus())
    rerenderUi(<Host id="b" focusTitle editing={editing} />)
    expect(editing.current).toEqual(['b'])
  })
})
