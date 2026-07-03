// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../../shared/types'
import { resetEditorSections } from './hooks/useEditorSections'
import './i18n'

// Pass-through triage that counts sort runs, so the derived-list stability test can
// assert renders without track changes skip the whole filter+sort pipeline.
const { sortRuns } = vi.hoisted(() => ({ sortRuns: { count: 0 } }))

// Pass-through Editor wrapped in its own memo, so the counter only ticks when App
// hands it a changed prop identity — the contract the editor-stability test pins.
const { editorRenders } = vi.hoisted(() => ({ editorRenders: { count: 0 } }))
vi.mock('./components/Editor', async (importOriginal) => {
  const real = await importOriginal<typeof import('./components/Editor')>()
  const { memo } = await import('react')
  const CountingEditor = memo(function CountingEditor(
    props: React.ComponentProps<typeof real.Editor>,
  ): React.JSX.Element {
    editorRenders.count++
    return <real.Editor {...props} />
  })
  return { ...real, Editor: CountingEditor }
})
vi.mock('./lib/triage', async (importOriginal) => {
  const real = await importOriginal<typeof import('./lib/triage')>()
  const sortTracks: typeof real.sortTracks = (tracks, sortBy, dir) => {
    sortRuns.count++
    return real.sortTracks(tracks, sortBy, dir)
  }
  return { ...real, sortTracks }
})
// The real changelog data grows with every release; pinning it keeps the what's-new
// tests about the launch gating, not about whatever shipped last.
vi.mock('./lib/changelog', () => ({
  changelogReleases: () => [
    {
      version: '0.33',
      date: '10 de julio de 2026',
      title: 'Novedades y avisos',
      items: [
        { text: 'Popup de novedades tras actualizar.', in: '0.33.0' },
        { text: 'Arreglo del análisis a 48 kHz.', in: '0.33.1' },
      ],
    },
  ],
}))

afterEach(cleanup)

function settings(over: Partial<Settings> = {}): Settings {
  return {
    theme: 'system',
    language: 'system',
    discogsToken: '',
    discogsFormats: [],
    discogsMaxResults: 10,
    searchProviders: ['discogs'],
    outputDir: '',
    outputFormat: 'aiff',
    addToAppleMusic: false,
    keepOutputCopy: true,
    overwriteOriginal: false,
    addToEngineDj: false,
    engineLibraryDir: '/music/Engine Library',
    engineDjPlaylist: 'Surco',
    filenameFormat: '{artist} - {title}',
    autoApplyFilename: false,
    groupingPresets: [],
    genrePresets: [],
    trimWhitespace: true,
    zeroPadTrack: true,
    visibleFields: ['title', 'artist'],
    requiredFields: ['title', 'artist'],
    coverMaxSize: 1000,
    coverSquare: false,
    replaceLowResCover: false,
    mp3Quality: '320',
    showSpectrum: true,
    activityPanel: null,
    autoAnalyze: false,
    showWaveform: true,
    showLoudness: false,
    autoMatch: false,
    continuousPlayback: false,
    keyNotation: 'camelot',
    normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
    shortcutOverrides: {},
    commandUsage: {},
    hasSeenOnboarding: true,
    conversionCount: 0,
    donateNudgeDismissed: false,
    donateNudgeLastShown: '',
    // Matches setApi's version so unrelated tests never trigger the launch stamp.
    lastSeenChangelogVersion: '0.0.0-test',
    ...over,
  }
}

// A clear cutoff well below Nyquist so the verdict is a real value (not 'unanalyzed'),
// which is what makes a quality dot appear on the row.
const spectrum = { image: 'data:image/png;base64,', cutoffHz: 16000, sampleRateHz: 44100 }
const wave = { peaks: [0.2, 0.8, 0.5, 1], durationSec: 180 }

// jsdom ships no IntersectionObserver. This stub records what each row observes and reports
// nothing visible by default, so a test can scroll a specific row into view on demand and
// assert the visible-gated auto-match only fires for what's on screen.
const observers: { cb: IntersectionObserverCallback; els: Set<Element> }[] = []
class MockIntersectionObserver {
  cb: IntersectionObserverCallback
  els = new Set<Element>()
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb
    observers.push({ cb, els: this.els })
  }
  observe(el: Element): void {
    this.els.add(el)
  }
  unobserve(el: Element): void {
    this.els.delete(el)
  }
  disconnect(): void {
    this.els.clear()
  }
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

// Reports every currently-observed row as on screen, driving the visible-gated auto-match the
// way a real scroll would — the mock reports nothing visible by default, so import-enqueued
// matches only fire once a test opts a row into view.
function showAllRows(): void {
  for (const o of observers) {
    const entries = [...o.els].map(
      (target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry,
    )
    if (entries.length) o.cb(entries, {} as IntersectionObserver)
  }
}

function setApi(over: Record<string, unknown> = {}): void {
  ;(window as unknown as { api: unknown }).api = {
    platform: 'win32',
    version: '0.0.0-test',
    getSettings: vi.fn().mockResolvedValue(settings()),
    saveSettings: vi.fn().mockResolvedValue(settings()),
    getConfigDir: vi.fn().mockResolvedValue(null),
    defaultConfigDir: vi.fn().mockResolvedValue('/Users/test/Library/Application Support/Surco'),
    cacheStats: vi.fn().mockResolvedValue({ files: 0, bytes: 0 }),
    clearCache: vi.fn().mockResolvedValue(undefined),
    onMenuCommand: () => () => {},
    onProcessProgress: () => () => {},
    onActivity: () => () => {},
    onUpdateDownloaded: () => () => {},
    onUpdateError: () => () => {},
    onOpenFiles: () => () => {},
    onFoldersChanged: () => () => {},
    unwatchFolders: vi.fn().mockResolvedValue(undefined),
    takePendingFiles: vi.fn().mockResolvedValue([]),
    getLastSession: vi.fn().mockResolvedValue([]),
    saveLastSession: vi.fn().mockResolvedValue(undefined),
    expandPaths: vi.fn((paths: string[]) => Promise.resolve(paths)),
    onWindowFocus: () => () => {},
    hasClipboardImage: vi.fn().mockResolvedValue(false),
    pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
    readTags: vi.fn().mockResolvedValue({}),
    readDuration: vi.fn().mockResolvedValue(180),
    readCover: vi.fn().mockResolvedValue(null),
    // Mirrors the real readMeta (one round-trip for all three) by delegating to the
    // individual mocks at call time, so a test overriding readTags/readDuration/readCover
    // still drives the import without having to know they were collapsed into one call.
    readMeta: vi.fn(async (path: string) => {
      const api = (window as unknown as { api: Record<string, (p: string) => unknown> }).api
      const [tags, duration, cover] = await Promise.all([
        api.readTags(path),
        api.readDuration(path),
        api.readCover(path),
      ])
      return { tags, duration, cover }
    }),
    properties: vi.fn().mockResolvedValue(null),
    loudness: vi.fn().mockResolvedValue(null),
    search: vi.fn().mockResolvedValue([]),
    getRelease: vi.fn().mockResolvedValue(null),
    spectrogram: vi.fn().mockResolvedValue(spectrum),
    waveform: vi.fn().mockResolvedValue(wave),
    ...over,
  }
}

beforeEach(() => {
  setApi()
  // The editor section store is module-level and survives across tests; reset it so a
  // test that folds a section away doesn't leak that state into the next.
  resetEditorSections()
  observers.length = 0
  globalThis.IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver
  // jsdom ships neither, and App's theme effect reads matchMedia on mount while
  // newTrack mints ids with crypto.randomUUID.
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia
  // jsdom implements none of HTMLMediaElement.play/pause/load; the floating player calls
  // play (and .catch on its returned promise) the instant it opens, pause on close or when
  // continuous playback advances, and load when its source changes.
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  HTMLMediaElement.prototype.pause = vi.fn()
  HTMLMediaElement.prototype.load = vi.fn()
  // jsdom has no 2D canvas context (it logs a not-implemented error and returns null);
  // the player's Waveform draws to one the moment playback opens. Stub it to null like
  // the Player/Waveform tests do, so the playback tests don't spew that error.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null)
})

// App and parts of its tree read window.api.platform at module scope, so it must be
// imported only after the bridge mock is in place — a dynamic import after beforeEach.
async function renderApp(): Promise<QueryClient> {
  const { default: App } = await import('./App')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
  return client
}

async function addTwoTracks(): Promise<HTMLElement[]> {
  fireEvent.click(await screen.findByTestId('add-files'))
  await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
  return screen.getAllByTestId('track-row')
}

describe('App quality triage', () => {
  // The "analyze quality" sweep exists to triage a whole dropped crate for fake-lossless
  // rips at once: every track gets measured and flagged with a verdict dot, so the user
  // never has to open each one. This is the behaviour the spectrum data layer must keep.
  it('measures every track and flags each with a quality verdict on demand', async () => {
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getByTestId('analyze-quality'))
    await waitFor(() => expect(screen.getAllByTestId('track-quality')).toHaveLength(2))
  })

  // Hovering a track warms its spectrum so its quality verdict shows in the list without
  // the user opening it — the prefetch that hides the ffmpeg latency behind the cursor.
  it('warms a hovered track so its verdict appears without opening it', async () => {
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.mouseEnter(rows[1])
    await waitFor(() => expect(within(rows[1]).getByTestId('track-quality')).toBeInTheDocument())
  })

  // Folding the Audio quality section away is the user's "stop analysing this" — but the
  // hover prefetch warmed the spectrum regardless, so collapsing the section still ran
  // the heavy ffmpeg decode behind every rested hover. With the section folded, hovering
  // a track must skip the spectrogram (the waveform, always shown by the player, still
  // warms) so folding actually stops the analysis.
  it('skips the spectrum prefetch for a hovered track while the quality section is folded', async () => {
    const spectrogram = vi.fn().mockResolvedValue(spectrum)
    const waveform = vi.fn().mockResolvedValue(wave)
    setApi({ spectrogram, waveform })
    await renderApp()
    const rows = await addTwoTracks()
    // Open the editor on the first track, then collapse its Audio quality section.
    fireEvent.click(rows[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Audio quality' }))
    // The waveform prefetch always runs on hover, so its call marks the moment the
    // (debounced) prefetch body executed — at which point the spectrogram must be untouched.
    fireEvent.mouseEnter(rows[1])
    await waitFor(() => expect(waveform).toHaveBeenCalledWith('/music/b.wav'))
    expect(spectrogram).not.toHaveBeenCalledWith('/music/b.wav')
  })

  // The player's waveform is the slowest decode (it reads the whole file) and only
  // mounts when playback starts, so without warming it the player opens to an empty
  // strip for seconds. Hovering the row a DJ is about to play primes that decode.
  it('warms a hovered track so its waveform is decoded before playback opens it', async () => {
    const waveform = vi.fn().mockResolvedValue(wave)
    setApi({ waveform })
    const client = await renderApp()
    const rows = await addTwoTracks()
    fireEvent.mouseEnter(rows[1])
    await waitFor(() => expect(waveform).toHaveBeenCalledWith('/music/b.wav'))
    expect(client.getQueryData(['waveform', '/music/b.wav'])).toEqual(wave)
  })

  // Starting the sweep then switching away must not keep ffmpeg churning in the
  // background: the sweep parks until the window is focused again, the whole point of
  // the blur pause (it must still finish once the app comes back).
  it('parks the analyze sweep while the window is in the background and resumes on focus', async () => {
    // Both the analyze sweep and the editor's cover well subscribe to window focus, so
    // the mock fans the event out to every listener instead of keeping only the last.
    const focusListeners: ((focused: boolean) => void)[] = []
    const setFocus = (focused: boolean): void => {
      for (const cb of focusListeners) cb(focused)
    }
    const spectrogram = vi.fn().mockResolvedValue(spectrum)
    setApi({
      spectrogram,
      onWindowFocus: (cb: (focused: boolean) => void) => {
        focusListeners.push(cb)
        return () => {}
      },
    })
    await renderApp()
    await addTwoTracks()
    // Let the selected track's editor warm its own spectrum first; the sweep is what
    // we're gating, so we measure new ffmpeg calls against that baseline.
    await new Promise((r) => setTimeout(r, 0))
    const baseline = spectrogram.mock.calls.length

    setFocus(false)
    fireEvent.click(screen.getByTestId('analyze-quality'))
    await new Promise((r) => setTimeout(r, 0))
    expect(spectrogram.mock.calls.length).toBe(baseline)

    setFocus(true)
    await waitFor(() => expect(spectrogram.mock.calls.length).toBeGreaterThan(baseline))
  })
})

describe('App auto-match', () => {
  // Auto-match exists to tag a crate from Discogs without a click per track: the toolbar
  // sweep searches each file, and when a release matches confidently it applies the
  // metadata outright and badges the row so the user can spot-check what was filled. This
  // is the end-to-end wiring (button → headless probe → apply → badge) that must hold.
  const release = {
    id: 1,
    title: 'Album',
    artists: [{ name: 'Artist' }],
    tracklist: [{ position: '1', title: 'My Song', duration: '3:00' }],
  }

  it('applies a confident Discogs match unattended and flags the row', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }])
    const getRelease = vi.fn().mockResolvedValue(release)
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ discogsToken: 'tok' })),
      // A title + duration the release agrees with scores 'high', the bar for applying.
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
      readDuration: vi.fn().mockResolvedValue(180),
      search,
      getRelease,
    })
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getByTestId('auto-match'))
    await waitFor(() => expect(screen.getAllByTestId('track-automatched')).toHaveLength(2))
    expect(search).toHaveBeenCalled()
  })

  // The toolbar sweep honours the active format filter: filter to MP3 and only the visible mp3
  // rows are probed, never the hidden wav. Otherwise a DJ narrowing to one format would still
  // fire Discogs calls (and write matches) for the tracks the filter is hiding.
  it('auto-matches only the visible rows when a format filter is active', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }])
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ discogsToken: 'tok' })),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.mp3']),
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
      readDuration: vi.fn().mockResolvedValue(180),
      search,
      getRelease: vi.fn().mockResolvedValue(release),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    // Narrow to MP3 — only the mp3 row shows.
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:MP3'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('auto-match'))
    // Only the single visible mp3 gets matched; the hidden wav is never swept in.
    await waitFor(() => expect(screen.getAllByTestId('track-automatched')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-all'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    expect(screen.getAllByTestId('track-automatched')).toHaveLength(1)
  })

  it('leaves the button disabled without a Discogs token to search', async () => {
    setApi({ readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }) })
    await renderApp()
    await addTwoTracks()
    expect(screen.getByTestId('auto-match')).toBeDisabled()
  })

  // Auto-match on import follows what's shown: a row is probed once it's actually on screen,
  // so an active filter never auto-matches the rows it hides. Here nothing is visible yet, so
  // no row matches until the test scrolls them into view — then both do.
  it('auto-matches an imported track only once its row is on screen', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }])
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ discogsToken: 'tok', autoMatch: true })),
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
      readDuration: vi.fn().mockResolvedValue(180),
      search,
      getRelease: vi.fn().mockResolvedValue(release),
    })
    await renderApp()
    await addTwoTracks()

    // Nothing is on screen (the observer reports nothing visible), so the import's auto-match
    // stays queued and no row is matched.
    await waitFor(() => expect(search).not.toHaveBeenCalled())
    expect(screen.queryAllByTestId('track-automatched')).toHaveLength(0)

    // Scrolling both rows into view releases the gate: both get matched.
    act(() => showAllRows())
    await waitFor(() => expect(screen.getAllByTestId('track-automatched')).toHaveLength(2))
  })

  // The track you're looking at shouldn't need the toolbar button: with auto-match on,
  // once the selection rests on a row it gets matched even if it was never scrolled into
  // view (the import gating only holds back the rows you aren't looking at).
  it('auto-matches the selected track without the toolbar button', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }])
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ discogsToken: 'tok', autoMatch: true })),
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
      readDuration: vi.fn().mockResolvedValue(180),
      search,
      getRelease: vi.fn().mockResolvedValue(release),
    })
    await renderApp()
    await addTwoTracks()

    // No row is scrolled into view; only the rested selection drives the match.
    await waitFor(
      () => expect(screen.getAllByTestId('track-automatched').length).toBeGreaterThan(0),
      {
        timeout: 2000,
      },
    )
    expect(search).toHaveBeenCalled()
  })

  // One row's malformed Discogs payload (a release without a tracklist) must skip
  // that track, not sink the sweep: the other rows still match, the progress pill
  // still completes, and nothing escapes as an unhandled rejection.
  it('survives a malformed release and still matches the remaining tracks', async () => {
    const getRelease = vi
      .fn()
      .mockResolvedValueOnce({ id: 1, title: 'Album' })
      .mockResolvedValue(release)
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ discogsToken: 'tok' })),
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
      readDuration: vi.fn().mockResolvedValue(180),
      search: vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }]),
      getRelease,
    })
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getByTestId('auto-match'))
    await waitFor(() => expect(screen.getAllByTestId('track-automatched')).toHaveLength(1))
    expect(screen.queryByTestId('app-error')).toBeNull()
  })

  // The sweep probes a snapshot of each track while the list stays fully editable. An
  // edit typed during a track's probe window must win over the match landing after it —
  // otherwise the user's words silently revert to Discogs's a few seconds later.
  it('never overwrites an edit typed while that track was being probed', async () => {
    let releaseGate: () => void = () => {}
    const gate = new Promise<void>((res) => {
      releaseGate = res
    })
    const getRelease = vi.fn(async () => {
      await gate
      return release
    })
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ discogsToken: 'tok' })),
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
      readDuration: vi.fn().mockResolvedValue(180),
      search: vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }]),
      getRelease,
    })
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getByTestId('auto-match'))
    await waitFor(() => expect(getRelease).toHaveBeenCalled())

    fireEvent.change(screen.getByTestId('field-title'), { target: { value: 'Hand Typed' } })
    releaseGate()

    // The untouched second track still matches; the edited one is left alone.
    await waitFor(() => expect(screen.getAllByTestId('track-automatched')).toHaveLength(1))
    expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('Hand Typed')
  })
})

describe('App track list label', () => {
  // The left list is a stable reference: it shows what each file was when imported and never
  // moves while the metadata form on the right is edited. Otherwise the row renames itself
  // under the cursor as you type a title — which is disorienting on a big crate.
  it('keeps the row label fixed while the title is edited in the form', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Imported Title', artist: 'Artist' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await screen.findByText('Imported Title')
    const row = screen.getByTestId('track-row')
    expect(within(row).getByText('Imported Title')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('field-title'), { target: { value: 'Hand Typed' } })

    expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('Hand Typed')
    expect(within(row).getByText('Imported Title')).toBeInTheDocument()
    expect(within(row).queryByText('Hand Typed')).not.toBeInTheDocument()
  })
})

describe('App import skeleton', () => {
  // "Add files" used to pass the picker's result straight to the list, so a folder picked
  // there (macOS lets the dialog select folders) imported nothing while the same folder
  // dropped in worked. Routing the picked paths through the same expand the drop uses makes
  // the button and the drop behave alike — a picked folder walks to its audio files.
  it('expands a folder chosen from the file picker into its audio files', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/crate']),
      expandPaths: vi.fn(async () => ['/music/crate/a.wav', '/music/crate/b.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    expect(window.api.expandPaths).toHaveBeenCalledWith(['/music/crate'])
  })

  // Reading tags/duration/cover up front used to block the whole drop behind the slowest
  // file: a cloud or network folder showed an empty list for seconds and looked broken
  // even though the import was running. The rows must appear the instant they're dropped,
  // parsed from the filename, with a loading placeholder until each file's metadata lands.
  it('shows dropped rows immediately while their metadata is still loading', async () => {
    let releaseTags: () => void = () => {}
    const tagsGate = new Promise<void>((res) => {
      releaseTags = res
    })
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
      readTags: vi.fn(async () => {
        await tagsGate
        return { title: 'Loaded', artist: 'Artist' }
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))

    // Rows render before any tag read resolves, each carrying a loading placeholder.
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    expect(screen.getAllByTestId('track-loading')).toHaveLength(2)

    // Once the reads land, the placeholders clear.
    releaseTags()
    await waitFor(() => expect(screen.queryAllByTestId('track-loading')).toHaveLength(0))
  })

  // A big drop reads tags for ages; an opaque animated bar gives no sense of how far along
  // it is. A "done/total" counter beside Add files turns the wait into visible progress and
  // clears once every file's metadata has landed.
  it('counts metadata-read progress beside Add files until the drop finishes', async () => {
    let releaseTags: () => void = () => {}
    const tagsGate = new Promise<void>((res) => {
      releaseTags = res
    })
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
      readTags: vi.fn(async () => {
        await tagsGate
        return { title: 'T', artist: 'A' }
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    // Reads are still gated → none of the two have resolved yet.
    expect(screen.getByTestId('import-progress')).toHaveTextContent('0/2')
    // Once both land, the counter clears.
    await act(async () => {
      releaseTags()
    })
    await waitFor(() => expect(screen.queryByTestId('import-progress')).toBeNull())
  })

  // The native file dialog can stay open for a long time; a file that arrives through
  // the OS meanwhile ("Open with Surco") must still dedupe against the picker's result —
  // the dedupe has to read the live list, not the snapshot from when the dialog opened.
  it('dedupes a file that arrived while the picker dialog was open', async () => {
    let openFiles: (paths: string[]) => Promise<void> = () => Promise.resolve()
    let resolvePick: (paths: string[]) => void = () => {}
    setApi({
      pickFiles: vi.fn(
        () =>
          new Promise<string[]>((res) => {
            resolvePick = res
          }),
      ),
      onOpenFiles: (cb: (paths: string[]) => Promise<void>) => {
        openFiles = cb
        return () => {}
      },
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))

    await act(async () => {
      await openFiles(['/music/a.wav'])
    })
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))

    await act(async () => {
      resolvePick(['/music/a.wav'])
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getAllByTestId('track-row')).toHaveLength(1)
  })

  // Re-dragging a folder used to be a silent no-op; now the skipped duplicates are
  // reported so the import doesn't look broken when nothing new appears.
  it('tells the user when re-imported files were already in the list', async () => {
    await renderApp()
    const rows = await addTwoTracks()
    expect(rows).toHaveLength(2)

    // Importing the same files again adds no rows and surfaces a notice.
    fireEvent.click(screen.getByTestId('add-files'))
    expect(await screen.findByTestId('app-notice')).toBeInTheDocument()
    expect(screen.getAllByTestId('track-row')).toHaveLength(2)
  })

  // The rows are editable from the instant they land, so a slow read (cloud folder) can
  // resolve after the user already typed into the form. The read fills what it learned,
  // but a field the user touched meanwhile must keep the user's value.
  it('keeps an edit typed while the file was still being read', async () => {
    let releaseTags: () => void = () => {}
    const tagsGate = new Promise<void>((res) => {
      releaseTags = res
    })
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn(async () => {
        await tagsGate
        return { title: '', artist: 'Tagged Artist' }
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))

    fireEvent.change(screen.getByTestId('field-title'), { target: { value: 'Hand Typed' } })
    releaseTags()

    await waitFor(() =>
      expect((screen.getByTestId('field-artist') as HTMLInputElement).value).toBe('Tagged Artist'),
    )
    expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('Hand Typed')
  })
})

describe('App error surfacing', () => {
  // The user confirmed a destructive dialog; if the OS trash call then fails, the row
  // must stay AND the failure must be said out loud — a silent catch reads as success
  // and the user walks away believing the file is gone.
  it('surfaces a failed trash instead of pretending the file was deleted', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      trashFile: vi.fn().mockRejectedValue(new Error('locked')),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))

    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-trash'))
    fireEvent.click(screen.getByTestId('confirm-ok'))

    expect(await screen.findByTestId('app-error')).toBeInTheDocument()
    expect(screen.getByTestId('track-row')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('app-error-dismiss'))
    expect(screen.queryByTestId('app-error')).toBeNull()
  })

  // A failed settings read leaves the whole session on defaults with onboarding
  // suppressed; it must say so rather than looking like a fresh, working install.
  it('surfaces a settings load failure', async () => {
    setApi({ getSettings: vi.fn().mockRejectedValue(new Error('corrupt')) })
    await renderApp()
    expect(await screen.findByTestId('app-error')).toBeInTheDocument()
  })

  // Anything IPC-shaped that rejects outside a catch (shell calls, fire-and-forget
  // writes) must surface instead of vanishing into the devtools console.
  it('surfaces unhandled promise rejections', async () => {
    await renderApp()
    const event = new Event('unhandledrejection') as unknown as PromiseRejectionEvent
    Object.defineProperty(event, 'reason', { value: new Error('boom') })
    act(() => {
      window.dispatchEvent(event)
    })
    expect(await screen.findByTestId('app-error')).toHaveTextContent('boom')
  })
})

describe('App loudness help overlay', () => {
  // The help dialog must gate the global shortcuts like every other modal. It used to
  // live inside the keyed Editor without setting overlayOpen: pressing the next-track
  // key with it open moved the selection, remounted the Editor, and silently destroyed
  // the dialog under the user.
  it('keeps track shortcuts gated while the loudness help dialog is open', async () => {
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ showLoudness: true })),
      loudness: vi.fn().mockResolvedValue({
        integratedLufs: -12,
        truePeakDb: -1.5,
        lra: 8,
        channelBalanceDb: 0.5,
        dcOffset: 0.0001,
        crestDb: 16,
        noiseFloorDb: -55,
      }),
    })
    await renderApp()
    await addTwoTracks()
    fireEvent.click(await screen.findByTestId('loudness-help-toggle'))
    // The help overlay is a lazy chunk, so it mounts a microtask after the click.
    expect(await screen.findByTestId('loudness-help')).toHaveAccessibleName()

    fireEvent.keyDown(window, { key: 'ArrowDown', cancelable: true })
    expect(screen.getByTestId('loudness-help')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('loudness-help')).toBeNull()
  })
})

describe('App track removal', () => {
  // Removed tracks must not pin their probe results in the session-long query cache:
  // spectrogram images are the heaviest objects in the app, and a long session of
  // add/remove would otherwise retain every one of them until quit.
  it('evicts a removed track’s cached probes', async () => {
    setApi({ pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']) })
    const client = await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    client.setQueryData(['spectrogram', '/music/a.wav'], spectrum)
    client.setQueryData(['bpm', '/music/a.wav'], 128)

    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-remove'))

    await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))
    expect(client.getQueryData(['spectrogram', '/music/a.wav'])).toBeUndefined()
    expect(client.getQueryData(['bpm', '/music/a.wav'])).toBeUndefined()
  })
})

describe('App multi-select removal', () => {
  // The right-click row stays selected when it's already part of the selection, so the
  // menu's list actions follow what's highlighted. "Remove from list" on one of several
  // selected rows must drop the whole selection, not just the clicked row.
  it('removes every selected track, not just the right-clicked one', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    fireEvent.contextMenu(rows[1])
    fireEvent.click(screen.getByTestId('track-menu-remove'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
  })

  // Same selection rule for the destructive action: "Move to Trash" sends every selected
  // file to the OS trash behind one confirm, not just the row under the cursor.
  it('trashes every selected file from the right-click menu', async () => {
    const trashFile = vi.fn().mockResolvedValue(undefined)
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      trashFile,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    fireEvent.contextMenu(rows[1])
    fireEvent.click(screen.getByTestId('track-menu-trash'))
    fireEvent.click(screen.getByTestId('confirm-ok'))
    await waitFor(() => expect(trashFile).toHaveBeenCalledTimes(2))
    expect(trashFile.mock.calls.map((c) => c[0]).sort()).toEqual(['/music/a.wav', '/music/b.wav'])
  })

  // The toolbar trash mirrors what's on screen, not the selection: with no filter every row is
  // visible, so it empties the whole list even when only some rows are multi-selected. Removing
  // just a few rows is the right-click "Remove from list"; this button is not selection-scoped.
  it('empties every visible row from the toolbar trash, ignoring the selection', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    fireEvent.click(screen.getByTestId('clear-all'))
    fireEvent.click(await screen.findByTestId('confirm-ok'))
    // The two-row selection doesn't narrow it: all three visible rows go.
    await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))
  })
})

describe('App row playback', () => {
  // Double-clicking a track is the quick "play this" gesture: it opens the floating
  // player straight on that row, without reaching for Space or the player toggle.
  it('opens the player on the double-clicked track', async () => {
    await renderApp()
    const rows = await addTwoTracks()
    expect(screen.queryByTestId('player')).toBeNull()
    // A real double-click selects the row first (the click) then fires dblclick.
    fireEvent.click(rows[1])
    fireEvent.doubleClick(rows[1])
    expect(await screen.findByTestId('player')).toBeInTheDocument()
  })

  // Double-click is a play/stop toggle on the row: a second double-click on the track
  // that's already playing stops it and closes the player.
  it('stops playback when the playing track is double-clicked again', async () => {
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[1])
    fireEvent.doubleClick(rows[1])
    expect(await screen.findByTestId('player')).toBeInTheDocument()
    fireEvent.click(rows[1])
    fireEvent.doubleClick(rows[1])
    await waitFor(() => expect(screen.queryByTestId('player')).toBeNull())
  })
})

describe('App track position', () => {
  // Auditioning a crate one by one, the DJ wants to see how far along they are. The
  // x/total counter sits beside the (collapsed) filter dropdown and stays visible even
  // with the whole library in view — that's the indicator the user relies on.
  it('shows the selected position as an x/total counter beside the filter', async () => {
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[1])
    expect(screen.getByTestId('track-position')).toHaveTextContent('2/2')
  })

  // Narrowing the view (a filter or, here, a search) can drop the selected track out of
  // sight, which used to hide the counter entirely. It must stay visible as "‒/total" so
  // the DJ still sees how many tracks the current view holds to go through.
  it('keeps the counter visible as ‒/total when the selection is filtered out of the view', async () => {
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[0])
    expect(screen.getByTestId('track-position')).toHaveTextContent('1/2')
    fireEvent.change(screen.getByTestId('track-search'), { target: { value: 'b' } })
    await waitFor(() => expect(screen.getByTestId('track-position')).toHaveTextContent('‒/1'))
  })
})

describe('App selection range', () => {
  // A Shift-click extends the range over the rows the user sees. When a filter (here a
  // search) hides a track that sits between the two clicks in import order, that hidden
  // track must NOT be swept into the selection — the range follows the visible order.
  it('ranges a Shift-click over the visible order, skipping filtered-out tracks', async () => {
    setApi({
      pickFiles: vi
        .fn()
        .mockResolvedValue(['/music/kick.wav', '/music/snare.wav', '/music/kick2.wav']),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    // Hide the middle track (snare); only kick and kick2 stay visible.
    fireEvent.change(screen.getByTestId('track-search'), { target: { value: 'kick' } })
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    const visible = screen.getAllByTestId('track-row')
    fireEvent.click(visible[0])
    fireEvent.click(visible[1], { shiftKey: true })
    // Clear the filter and confirm the hidden snare was never selected: exactly the two
    // visible rows are pressed, not the three the import-order range would have taken.
    fireEvent.change(screen.getByTestId('track-search'), { target: { value: '' } })
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    const pressed = screen
      .getAllByTestId('track-row')
      .filter((r) => r.getAttribute('aria-selected') === 'true')
    expect(pressed).toHaveLength(2)
  })
})

describe('App start over', () => {
  // A bad match or stray edits can leave a track worse than when it landed; the
  // right-click "Start over" rebuilds the row from the file alone — re-reading its
  // tags and dropping every edit — exactly as if it had just been dropped again.
  it('re-reads the file and discards edits when starting over', async () => {
    const readTags = vi.fn().mockResolvedValue({ title: 'Imported Title', artist: 'Artist' })
    setApi({ pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']), readTags })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await screen.findByText('Imported Title')
    fireEvent.change(screen.getByTestId('field-title'), { target: { value: 'Hand Typed' } })
    const reads = readTags.mock.calls.length

    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-startover'))

    await waitFor(() =>
      expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('Imported Title'),
    )
    expect(readTags.mock.calls.length).toBe(reads + 1)
  })

  // The other half of the reset: the Discogs box must re-seed from the fresh read so
  // the search can start over too, not keep whatever query the user had typed into it.
  it('re-seeds the Discogs search box so the search can start again', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Imported Title', artist: 'Artist' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await screen.findByText('Imported Title')
    fireEvent.change(screen.getByTestId('discogs-query'), { target: { value: 'scribbles' } })

    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-startover'))

    await waitFor(() =>
      expect((screen.getByTestId('discogs-query') as HTMLInputElement).value).not.toBe('scribbles'),
    )
  })
})

describe('App regenerate filename', () => {
  // The fast path: one click on Regenerate rewrites the output name from the Settings
  // naming pattern, no modal. This is the wiring that lets a user retag and rename in two
  // clicks instead of opening the builder for every track.
  it('rewrites the output name from the Settings pattern in one click', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/raw 01.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Bumping', artist: 'Di Carlo' }),
      getSettings: vi.fn().mockResolvedValue(settings({ filenameFormat: '{artist} - {title}' })),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('regenerate-output-name'))
    await waitFor(() => expect(screen.getByTestId('output-name')).toHaveValue('Di Carlo - Bumping'))
  })

  // The copy button hands the same Settings-pattern name to the OS clipboard so the user
  // can paste the track straight into Google or Soulseek to hunt for a better rip.
  it('copies the Settings-pattern file name to the clipboard in one click', async () => {
    const copyText = vi.fn().mockResolvedValue(undefined)
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/raw 01.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Bumping', artist: 'Di Carlo' }),
      getSettings: vi.fn().mockResolvedValue(settings({ filenameFormat: '{artist} - {title}' })),
      copyText,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('copy-filename-btn'))
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('Di Carlo - Bumping'))
  })
})

describe('App open with', () => {
  // "Open With Surco" in Finder launches the app and hands the chosen file to the OS
  // open-file event, which the main process buffers (the renderer isn't alive yet on a
  // cold launch). The renderer must drain that buffer on mount so the file lands in the
  // list exactly as a drop would — otherwise the menu entry opens an empty window.
  it('adds files handed over by the OS on launch (Open With)', async () => {
    setApi({
      takePendingFiles: vi.fn().mockResolvedValue(['/music/opened.flac']),
      readTags: vi.fn().mockResolvedValue({ title: 'Opened', artist: 'Artist' }),
    })
    await renderApp()
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
  })

  // While the app is already running, opening another file from Finder pushes it straight
  // to the live window through onOpenFiles. The same path that fed the cold-launch drain
  // must also accept these so a second "Open With" appends to the existing crate.
  it('appends files pushed to an already-running window', async () => {
    let push: ((paths: string[]) => void) | undefined
    setApi({
      onOpenFiles: (cb: (paths: string[]) => void) => {
        push = cb
        return () => {}
      },
      readTags: vi.fn().mockResolvedValue({ title: 'Live', artist: 'Artist' }),
    })
    await renderApp()
    await screen.findByTestId('add-files')
    push?.(['/music/live.flac'])
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
  })
})

describe('App multi-select convert', () => {
  // The reason this matters: users with a large crate (e.g. 400 tracks) tag a handful, select
  // just those, and hit convert expecting only the selection to run. Converting the whole list
  // would rewrite files they hadn't finished — the multi-select convert must honour the selection.
  it('converts only the selected tracks, not the whole list', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/x.aiff', inPlace: false })
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    // Multi-select reuses the single editor; its convert button reads "Convert (2)".
    const convert = await screen.findByTestId('process-btn')
    expect(convert).toHaveTextContent('Convert (2)')
    fireEvent.click(convert)
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(2))
    const converted = processTrack.mock.calls.map((c) => c[0].inputPath).sort()
    expect(converted).toEqual(['/music/a.wav', '/music/b.wav'])
  })
})

describe('App keyboard shortcuts', () => {
  // ⌘K (Ctrl+K off macOS) opens the command palette from anywhere, and Escape closes
  // it — the two keys the global handler special-cases before any track command.
  it('opens the command palette with the shortcut and closes it on Escape', async () => {
    await renderApp()
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    expect(await screen.findByTestId('palette-input')).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('palette-input')).toBeNull())
  })
})

describe('App command palette', () => {
  // A palette command whose action opens another modal (here Settings) must land on that
  // modal, not be swallowed when the palette closes itself in the same click.
  it('keeps the command-opened modal up after the palette closes itself', async () => {
    await renderApp()
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    const input = await screen.findByTestId('palette-input')
    fireEvent.change(input, { target: { value: 'Settings' } })
    fireEvent.click(screen.getByTestId('palette-item'))
    await waitFor(() => expect(screen.getByTestId('settings-tab-general')).toBeInTheDocument())
    expect(screen.queryByTestId('palette-input')).toBeNull()
  })
})

describe('App settings button', () => {
  // The header button wires onClick straight to the opener, so React hands it the click
  // event. The opener used to read that event as its tab argument, leaving the modal on a
  // bogus tab with no panel selected and an empty body. Opening must always land on General.
  it('opens the settings modal on the General tab', async () => {
    await renderApp()
    fireEvent.click(screen.getByTestId('open-settings'))
    await waitFor(() =>
      expect(screen.getByTestId('settings-tab-general')).toHaveAttribute('aria-selected', 'true'),
    )
  })
})

describe('App landmarks', () => {
  // A screen reader user lands in an app with no document outline; a single top-level
  // heading names the window so they know where they are.
  it('exposes a top-level heading for orientation', async () => {
    await renderApp()
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
})

describe('App command palette list-wide actions', () => {
  // The list-wide toolbar actions are reachable from the palette too, so a keyboard-only
  // user can run them without hunting for the icon. Stats needs no loaded tracks, so it
  // proves the run wiring on its own.
  it('runs a list-wide action from the palette (Stats opens its settings tab)', async () => {
    await renderApp()
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    const input = await screen.findByTestId('palette-input')
    fireEvent.change(input, { target: { value: 'Stats' } })
    const items = screen.getAllByTestId('palette-item')
    expect(items).toHaveLength(1)
    fireEvent.click(items[0])
    await waitFor(() =>
      expect(screen.getByTestId('settings-tab-stats')).toHaveAttribute('aria-selected', 'true'),
    )
  })

  // The list-wide commands act on the whole crate, so they stay disabled until something
  // is loaded — the palette must honour the same gate the toolbar buttons do.
  it('disables the list-wide commands until tracks are loaded', async () => {
    await renderApp()
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    const input = await screen.findByTestId('palette-input')
    fireEvent.change(input, { target: { value: 'Export' } })
    expect(screen.getByTestId('palette-item')).toHaveAttribute('aria-disabled', 'true')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await addTwoTracks()
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    fireEvent.change(await screen.findByTestId('palette-input'), { target: { value: 'Export' } })
    expect(screen.getByTestId('palette-item')).toHaveAttribute('aria-disabled', 'false')
  })

  // "Clear the list" discards every unsaved edit in the session (matches, covers, tags
  // live only in memory), so the palette — and the native menu, which fires the same
  // command — must ask first, exactly like the toolbar button it mirrors. Its label
  // matches that button so searching "clear" surfaces it.
  it('asks for confirmation before clearing the list from the palette', async () => {
    await renderApp()
    await addTwoTracks()
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    fireEvent.change(await screen.findByTestId('palette-input'), {
      target: { value: 'Clear the list' },
    })
    fireEvent.click(screen.getByTestId('palette-item'))
    expect(screen.getAllByTestId('track-row')).toHaveLength(2)
    fireEvent.click(await screen.findByTestId('confirm-ok'))
    await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))
  })

  // The palette's "Clear the list" is the deliberate start-over: unlike the toolbar trash
  // (which mirrors the filter), it wipes every track including the ones an active format
  // filter is hiding — so a filtered view can't leave stragglers behind after a clear.
  it('clears the whole list from the palette even with a format filter active', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.mp3']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    // Narrow to MP3 — the wav is hidden.
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:MP3'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    fireEvent.change(await screen.findByTestId('palette-input'), {
      target: { value: 'Clear the list' },
    })
    fireEvent.click(screen.getByTestId('palette-item'))
    fireEvent.click(await screen.findByTestId('confirm-ok'))
    // Both the visible mp3 and the hidden wav are gone: the whole list is empty, and with no
    // rows left the sidebar (filter and all) collapses to the drop zone. Had the clear honoured
    // the MP3 filter, the hidden wav would have survived and a row would remain.
    await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))
    expect(screen.queryByTestId('quality-filter-trigger')).toBeNull()
  })
})

describe('App keyboard navigation', () => {
  // Arrow keys step the selection through the visible rows, moving DOM focus with it
  // so the native focus ring follows the keyboard instead of the last click.
  it('moves the selection and focus to the next row on ArrowDown', async () => {
    await renderApp()
    const rows = await addTwoTracks()
    expect(rows[0]).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(window, { key: 'ArrowDown', cancelable: true })

    await waitFor(() => expect(rows[1]).toHaveAttribute('aria-selected', 'true'))
    expect(rows[1]).toHaveFocus()
  })

  // Auditioning a crate one by one, the DJ wants to see how far along they are: the
  // x/total counter follows the arrow keys.
  it('shows the selected track position and follows navigation', async () => {
    await renderApp()
    await addTwoTracks()
    expect(screen.getByTestId('track-position')).toHaveTextContent('1/2')

    fireEvent.keyDown(window, { key: 'ArrowDown', cancelable: true })

    await waitFor(() => expect(screen.getByTestId('track-position')).toHaveTextContent('2/2'))
  })
})

describe('App continuous playback', () => {
  // With the mode on, a finished track hands off to the next visible row so a queued
  // crate plays through unattended — the same advance the arrow keys make.
  it('advances to the next track when one finishes', async () => {
    setApi({ getSettings: vi.fn().mockResolvedValue(settings({ continuousPlayback: true })) })
    await renderApp()
    const rows = await addTwoTracks()
    expect(rows[0]).toHaveAttribute('aria-selected', 'true')

    const audio = document.querySelector('audio')
    if (!audio) throw new Error('expected the player audio element')
    fireEvent(audio, new Event('ended'))

    await waitFor(() => expect(rows[1]).toHaveAttribute('aria-selected', 'true'))
  })

  // With the mode off, finishing a track leaves the selection put rather than
  // rolling into the next one.
  it('leaves the selection put when continuous playback is off', async () => {
    setApi({ getSettings: vi.fn().mockResolvedValue(settings({ continuousPlayback: false })) })
    await renderApp()
    const rows = await addTwoTracks()

    const audio = document.querySelector('audio')
    if (!audio) throw new Error('expected the player audio element')
    fireEvent(audio, new Event('ended'))

    expect(rows[0]).toHaveAttribute('aria-selected', 'true')
    expect(rows[1]).toHaveAttribute('aria-selected', 'false')
  })
})

describe('App editor prop stability', () => {
  // Typing in the sidebar search filters the list; none of the editor's inputs change,
  // so the memoized editor subtree must not re-render per keystroke — that's the whole
  // point of keeping its props identity-stable.
  it('keeps the editor props stable while typing in the search box', async () => {
    setApi({ pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']) })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    await screen.findByTestId('field-title')

    const before = editorRenders.count
    fireEvent.change(screen.getByTestId('track-search'), { target: { value: 'zz' } })
    expect(editorRenders.count).toBe(before)
  })
})

describe('App derived list stability', () => {
  // The triage pipeline (quality filter + search match + sort) is memoized on the
  // tracks view. A render that changes neither tracks nor spectra — opening a modal,
  // a progress counter tick — must not re-run it: on a big crate that pipeline is an
  // O(n log n) scan paid on every keystroke and sweep event otherwise.
  it('does not re-run the list sort on a render that changes no track data', async () => {
    await renderApp()
    await addTwoTracks()
    // Let pending meta reads (tags/duration/cover) settle so their setTracks renders
    // are behind us before sampling the baseline.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    const before = sortRuns.count
    fireEvent.click(screen.getByTestId('open-find-replace'))
    await screen.findByTestId('find-replace-find')
    expect(sortRuns.count).toBe(before)
  })
})

describe('App sort direction', () => {
  // The drop order ('Default') has no direction to flip, so the toggle stays hidden until
  // an actual sort key is chosen — otherwise it would imply reversing a non-existent order.
  it('hides the direction toggle for the default drop order and shows it once a sort is picked', async () => {
    await renderApp()
    await addTwoTracks()
    expect(screen.queryByTestId('track-sort-direction')).toBeNull()
    fireEvent.click(screen.getByTestId('track-sort'))
    fireEvent.click(screen.getByTestId('track-sort-option-name'))
    const toggle = screen.getByTestId('track-sort-direction')
    expect(toggle).toBeInTheDocument()
    // The hint comes from the themed Tooltip, not a native title — so the control reads
    // the same as the rest of the app and tracks the theme.
    expect(toggle).not.toHaveAttribute('title')
  })

  it('flips between ascending and descending when the toggle is pressed', async () => {
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getByTestId('track-sort'))
    fireEvent.click(screen.getByTestId('track-sort-option-name'))
    const toggle = screen.getByTestId('track-sort-direction')
    // Ascending is the default a freshly-picked sort starts on.
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('App per-format filter', () => {
  // Drops the wav + mp3 pair the format cases lean on (both unconverted, distinct formats).
  async function addMixedCrate(): Promise<void> {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.mp3']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
  }

  // The format axis ANDs with the primary bucket instead of replacing it: narrowing to a
  // primary, then to a format, refines the already-filtered set rather than resetting it.
  it('combines a primary bucket with a format, narrowing to their intersection', async () => {
    await addMixedCrate()
    // Both tracks are unconverted, so the primary alone keeps the pair…
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-unconverted'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    // …then reopening and layering the WAV format narrows it to just the wav, the conversion
    // axis still applied (each pick closes the menu, so the second needs a fresh open).
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:WAV'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
  })

  // The format axis is scoped to the current crate, so when its format leaves the list it
  // must fall back to every format rather than strand the user on an empty refinement
  // (unlike the deliberately-sticky Apple Music buckets).
  it('falls back to every format when the filtered format is no longer present', async () => {
    await addMixedCrate()
    // Narrow to just the MP3.
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:MP3'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-remove'))
    // The crate is now WAV-only: had the format filter stayed on MP3 the WAV row would be
    // hidden (0 rows). Seeing it proves the format filter reset.
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
  })

  // The bug a DJ hit: filter to one format (MP3), press "Empty" expecting only those gone,
  // and the hidden WAV/FLAC rows vanish too. Empty must honour the active filter and drop
  // only the visible rows, leaving the ones the filter is hiding on disk-and-in-list.
  it('empties only the visible rows when a format filter is active', async () => {
    await addMixedCrate()
    // Narrow to MP3 — only the mp3 row shows.
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:MP3'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('clear-all'))
    fireEvent.click(await screen.findByTestId('confirm-ok'))
    // The mp3 is gone. The format axis, now MP3-less, falls back to every format, so the wav
    // that was hidden behind the filter shows — proof Empty didn't sweep it in. Had Empty
    // cleared the whole list, no row would remain.
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    expect(screen.getByTestId('track-row')).toHaveTextContent('WAV')
  })

  // Find & Replace overwrites tags, so it too must honour the filter: with MP3 shown, the
  // preview (and the apply) covers only the visible mp3, not the hidden wav — otherwise a
  // cleanup pass would silently rewrite rows the user filtered out of view.
  it('scopes Find & Replace to the visible rows when a format filter is active', async () => {
    await addMixedCrate()
    // Both rows share artist 'A'; unscoped, a replace on 'A' would hit both.
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:MP3'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('open-find-replace'))
    fireEvent.change(await screen.findByTestId('find-replace-find'), { target: { value: 'A' } })
    fireEvent.change(screen.getByTestId('find-replace-replace'), { target: { value: 'Z' } })
    // The preview counts one track — the visible mp3 — not the two-track crate.
    expect(screen.getByTestId('find-replace-apply')).toHaveTextContent('1')
  })
})

describe('App filter selection', () => {
  // A filter that hides the selected track (here the format axis, which used not to react)
  // must drop the selection onto the first row the new view shows — otherwise the list sits
  // with nothing visibly selected and the editor lingers on an off-screen track.
  it('moves the selection to the first visible track when the format filter hides the selected one', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.mp3']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    // Import auto-selects the first row (the wav). Filtering to MP3 hides it…
    expect(screen.getAllByTestId('track-row')[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:MP3'))
    // …so the lone remaining row (the mp3) becomes the selected one.
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    expect(screen.getAllByTestId('track-row')[0]).toHaveAttribute('aria-selected', 'true')
  })
})

describe('App select all', () => {
  // One control, two jobs: select-all selects every track, and pressing it again once they
  // are all selected clears the selection instead of pointlessly re-selecting the same set.
  it('toggles between selecting every track and clearing the selection', async () => {
    await renderApp()
    await addTwoTracks()
    const selectAll = screen.getByTestId('select-all')
    fireEvent.click(selectAll)
    let rows = screen.getAllByTestId('track-row')
    expect(rows[0]).toHaveAttribute('aria-selected', 'true')
    expect(rows[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(selectAll)
    rows = screen.getAllByTestId('track-row')
    expect(rows[0]).toHaveAttribute('aria-selected', 'false')
    expect(rows[1]).toHaveAttribute('aria-selected', 'false')
  })

  // The bug a DJ hit: filter to one format (MP3), press Select All expecting only those, then
  // convert — and the hidden FLAC/WAV rows convert too. Select All must honour the active
  // filter and select only the visible rows, never the ones the filter is hiding. Two MP3s so
  // Select All has more than the one already-selected row to grab (and isn't a clear-toggle).
  it('selects only the visible rows when a format filter is active', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.mp3', '/music/c.mp3']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    // Narrow to MP3 — only the two mp3 rows show.
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:MP3'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.click(screen.getByTestId('select-all'))
    // Both visible mp3 rows are selected; the hidden wav is not swept in.
    let rows = screen.getAllByTestId('track-row')
    expect(rows[0]).toHaveAttribute('aria-selected', 'true')
    expect(rows[1]).toHaveAttribute('aria-selected', 'true')
    // Clearing the filter reveals all three: exactly the two mp3s stay selected. Had Select
    // All grabbed the hidden wav too, all three would read selected here.
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-all'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    rows = screen.getAllByTestId('track-row')
    const selected = rows.filter((r) => r.getAttribute('aria-selected') === 'true')
    expect(selected).toHaveLength(2)
  })
})

describe('App donate nudge', () => {
  afterEach(() => vi.restoreAllMocks())

  // Settles pending settings promises before the test ends, so no setSettings
  // lands after restoreAllMocks has reset the matchMedia stub.
  const flush = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

  function eligible(over: Partial<Settings> = {}): Settings {
    return settings({ conversionCount: 50, ...over })
  }

  // An eligible profile that just converted a selection: the nudge rides that moment of
  // value (not app launch), so a successful run is what reveals it. The convert path
  // produces a real output, the api returns the eligible profile both at load and on the
  // re-read, and the draw is forced to land.
  async function convertOnEligibleProfile(over: Record<string, unknown> = {}): Promise<void> {
    setApi({
      getSettings: vi.fn().mockResolvedValue(eligible()),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack: vi.fn().mockResolvedValue({ outputPath: '/out/x.aiff', inPlace: false }),
      ...over,
    })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    // Convert from the editor footer (the toolbar's convert button was removed as a duplicate).
    fireEvent.click(await screen.findByTestId('process-btn'))
  }

  // The nudge moved off app launch onto the moment of value: opening Surco is when the
  // user wants to work, not be asked for money. An eligible profile that just launched
  // and hasn't converted anything yet must see nothing, even when the draw would land.
  it('does not appear on launch before any conversion', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01)
    setApi({ getSettings: vi.fn().mockResolvedValue(eligible()) })
    await renderApp()
    await flush()
    expect(screen.queryByTestId('donate-nudge-count')).toBeNull()
  })

  // After a conversion lands, the occasional "what Surco saved you" summary appears — and
  // the showing is stamped immediately, so the cooldown holds even if the app quits right
  // after. The count reads the re-read profile, so it reflects the conversion just done.
  it('shows the stats summary after a conversion when the draw lands and stamps the showing', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01)
    const saveSettings = vi.fn().mockResolvedValue(eligible())
    await convertOnEligibleProfile({ saveSettings })
    expect(await screen.findByTestId('donate-nudge-count')).toHaveTextContent('50')
    expect(saveSettings).toHaveBeenCalledWith({ donateNudgeLastShown: expect.any(String) })
    await flush()
  })

  // Converting the selected track through the process-current shortcut (mod+Enter) is the
  // same moment of value as the Editor's convert button, so it must reveal the nudge too —
  // otherwise a keyboard user converting one track at a time would never see it.
  it('shows the nudge after a single convert via the process-current shortcut', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01)
    setApi({
      getSettings: vi.fn().mockResolvedValue(eligible()),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack: vi.fn().mockResolvedValue({ outputPath: '/out/x.aiff', inPlace: false }),
      saveSettings: vi.fn().mockResolvedValue(eligible()),
    })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[0])
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true })
    expect(await screen.findByTestId('donate-nudge-count')).toHaveTextContent('50')
    await flush()
  })

  // "No volver a mostrar" is a promise: ticking it must persist, not just close.
  it('persists the permanent dismissal from the checkbox', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01)
    const saveSettings = vi.fn().mockResolvedValue(eligible())
    await convertOnEligibleProfile({ saveSettings })
    await screen.findByTestId('donate-nudge-dismiss')
    fireEvent.click(screen.getByTestId('donate-nudge-dismiss'))
    fireEvent.click(screen.getByTestId('donate-nudge-close'))
    expect(saveSettings).toHaveBeenCalledWith({ donateNudgeDismissed: true })
    expect(screen.queryByTestId('donate-nudge-count')).toBeNull()
    await flush()
  })

  // The other side of "random, every now and then": most conversions show nothing.
  it('stays away when the draw misses', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    await convertOnEligibleProfile()
    await screen.findByTestId('batch-summary')
    expect(screen.queryByTestId('donate-nudge-count')).toBeNull()
    await flush()
  })
})

describe("App what's new popup", () => {
  const flush = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

  // The point of the feature: an update announces exactly what it shipped — the 0.33.0
  // item was already seen, only the 0.33.1 one is news. The running version is stamped
  // immediately so the popup fires once per update, never on every launch.
  it('shows only the unseen items after an update and stamps the running version', async () => {
    const saveSettings = vi.fn().mockResolvedValue(settings())
    setApi({
      version: '0.33.1',
      getSettings: vi
        .fn()
        .mockResolvedValue(settings({ lastSeenChangelogVersion: '0.33.0' })),
      saveSettings,
    })
    await renderApp()
    expect(await screen.findByText('Arreglo del análisis a 48 kHz.')).toBeInTheDocument()
    expect(screen.queryByText('Popup de novedades tras actualizar.')).toBeNull()
    expect(saveSettings).toHaveBeenCalledWith({ lastSeenChangelogVersion: '0.33.1' })
    await flush()
  })

  // A fresh install has nothing to announce (onboarding owns that launch), but the
  // version is still stamped silently — otherwise the second launch would "discover"
  // the current changelog and pop it at a user who didn't update anything.
  it('stays silent on a fresh install but stamps the version for the next update', async () => {
    const saveSettings = vi.fn().mockResolvedValue(settings())
    setApi({
      version: '0.33.1',
      getSettings: vi
        .fn()
        .mockResolvedValue(
          settings({ hasSeenOnboarding: false, lastSeenChangelogVersion: '' }),
        ),
      saveSettings,
    })
    await renderApp()
    await flush()
    expect(screen.queryByTestId('whats-new-close')).toBeNull()
    expect(saveSettings).toHaveBeenCalledWith({ lastSeenChangelogVersion: '0.33.1' })
  })

  // Same version, same launch as always: nothing to show, nothing to write.
  it('does nothing when the running version was already seen', async () => {
    const saveSettings = vi.fn().mockResolvedValue(settings())
    setApi({
      version: '0.33.1',
      getSettings: vi
        .fn()
        .mockResolvedValue(settings({ lastSeenChangelogVersion: '0.33.1' })),
      saveSettings,
    })
    await renderApp()
    await flush()
    expect(screen.queryByTestId('whats-new-close')).toBeNull()
    expect(saveSettings).not.toHaveBeenCalledWith({ lastSeenChangelogVersion: '0.33.1' })
  })
})

describe('App Apple Music library filter', () => {
  // The whole point of the filter: after importing a crate, the user wants to see only
  // the tracks they don't already own in Apple Music, so they don't re-import duplicates.
  // The library snapshot is matched against the crate locally, the two buckets get their
  // chips, and the "not in library" chip narrows the list to the ones still worth adding.
  it('matches imported tracks against the library and filters down to the ones not yet owned', async () => {
    setApi({
      // The library snapshot and the per-track lookup are macOS-only, and the check
      // only runs while Apple Music is the conversion destination.
      platform: 'darwin',
      getSettings: vi.fn().mockResolvedValue(settings({ addToAppleMusic: true })),
      readTags: vi.fn((path: string) =>
        Promise.resolve(
          path.includes('a.wav')
            ? { artist: 'deadmau5', title: 'Strobe' }
            : { artist: 'deadmau5', title: 'Ghosts' },
        ),
      ),
      loadAppleMusicLibrary: vi.fn().mockResolvedValue([{ title: 'Strobe', artist: 'deadmau5' }]),
    })
    await renderApp()
    await addTwoTracks()
    // Both tracks get a verdict from the snapshot, so both library buckets list in the
    // filter menu: one owned (Strobe), one missing (Ghosts).
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    const notInLibrary = await screen.findByTestId('quality-filter-notInLibrary')
    expect(screen.getByTestId('quality-filter-inLibrary')).toBeInTheDocument()
    // Filtering to "not in library" leaves only the track the library doesn't hold.
    fireEvent.click(notInLibrary)
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
  })

  // Off macOS there is no library to read, so the buckets never resolve and must not be
  // listed — a Windows build shows no Apple Music filters in the menu at all.
  it('lists no library buckets off macOS', async () => {
    setApi({
      readTags: vi.fn().mockResolvedValue({ artist: 'deadmau5', title: 'Strobe' }),
      loadAppleMusicLibrary: vi.fn().mockResolvedValue([{ title: 'Strobe', artist: 'deadmau5' }]),
    })
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    expect(screen.queryByTestId('quality-filter-notInLibrary')).toBeNull()
    expect(screen.queryByTestId('quality-filter-inLibrary')).toBeNull()
  })
})

describe('App metadata undo', () => {
  // Batch tag operations are one keystroke away (⌘E clears the whole selection) and used
  // to be unrecoverable — a slip destroyed hand-typed or Discogs-applied work. ⌘Z must
  // bring back exactly what the clear wiped and confirm it did, so the user knows the
  // slip was absorbed rather than wondering what state the crate is in.
  it('restores cleared metadata with the undo shortcut and confirms it', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Imported Title', artist: 'Artist' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await screen.findByText('Imported Title')
    expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('Imported Title')

    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
    expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('')

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('Imported Title')
    expect(screen.getByText('Metadata restored on 1 track')).toBeInTheDocument()
  })

  // The find & replace modal rewrites text fields across every visible track in one apply;
  // one ⌘Z afterwards must roll the whole sweep back, not just a single row.
  it('rolls back a find & replace sweep across tracks in one undo', async () => {
    setApi({
      readTags: vi.fn().mockResolvedValue({ title: 'Deep Mix', artist: 'Artist' }),
    })
    await renderApp()
    await addTwoTracks()

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    fireEvent.change(await screen.findByTestId('find-replace-find'), { target: { value: 'Deep' } })
    fireEvent.change(screen.getByTestId('find-replace-replace'), { target: { value: 'Dub' } })
    fireEvent.click(screen.getByTestId('find-replace-apply'))
    await waitFor(() =>
      expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('Dub Mix'),
    )

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('Deep Mix')
    expect(screen.getByText('Metadata restored on 2 tracks')).toBeInTheDocument()
  })
})

describe('App reopen last session', () => {
  // The app opens empty every launch; someone cleaning the same downloads folder over
  // days re-imported it by hand every time. The launch offer restores the previous
  // list in one click — through the same expand pipeline as a drop, so media access
  // and metadata reads behave exactly like a fresh import.
  it('offers the previous session at launch and loads it on accept', async () => {
    setApi({
      getLastSession: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
    })
    await renderApp()
    await screen.findByTestId('last-session')
    fireEvent.click(screen.getByTestId('last-session-action'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
  })

  // Accepting must retire the prompt itself: it once stayed up after the click (the
  // toast id ref was cleared before the withdraw effect could use it), so every extra
  // press re-imported the same session and rained "already in the list" notices.
  it('dismisses the offer once accepted', async () => {
    setApi({
      getLastSession: vi.fn().mockResolvedValue(['/music/a.wav']),
    })
    await renderApp()
    await screen.findByTestId('last-session')
    fireEvent.click(screen.getByTestId('last-session-action'))
    await waitFor(() => expect(screen.queryByTestId('last-session')).toBeNull())
  })

  it('stays quiet when there is no previous session', async () => {
    await renderApp()
    await screen.findByTestId('add-files')
    expect(screen.queryByTestId('last-session')).toBeNull()
  })

  // An unanswered launch offer must not park in the corner forever: like the
  // new-tracks prompt it carries a duration, so the shared toast draws its
  // countdown bar and retires the card on its own. The stored session survives
  // the expiry, so the next launch simply offers again.
  it('auto-dismisses the offer with a visible countdown', async () => {
    setApi({
      getLastSession: vi.fn().mockResolvedValue(['/music/a.wav']),
    })
    await renderApp()
    await screen.findByTestId('last-session')
    expect(screen.getByTestId('last-session-countdown')).toBeInTheDocument()
  })

  // If the user has already started importing, restoring the old list on top would mix
  // two sessions — the offer withdraws itself the moment rows exist.
  it('withdraws the offer once tracks arrive another way', async () => {
    setApi({
      getLastSession: vi.fn().mockResolvedValue(['/music/old.wav']),
    })
    await renderApp()
    await screen.findByTestId('last-session')
    await addTwoTracks()
    await waitFor(() => expect(screen.queryByTestId('last-session')).toBeNull())
  })

  it('remembers the loaded list for the next launch', async () => {
    const saveLastSession = vi.fn().mockResolvedValue(undefined)
    setApi({ saveLastSession })
    await renderApp()
    await addTwoTracks()
    await waitFor(() =>
      expect(saveLastSession).toHaveBeenCalledWith(['/music/a.wav', '/music/b.wav']),
    )
  })

  // The launch-time empty list must never be saved: it would wipe the stored session
  // before the reopen offer had a chance to restore it.
  it('does not overwrite the stored session with the empty launch list', async () => {
    const saveLastSession = vi.fn().mockResolvedValue(undefined)
    setApi({
      getLastSession: vi.fn().mockResolvedValue(['/music/a.wav']),
      saveLastSession,
    })
    await renderApp()
    await screen.findByTestId('last-session')
    expect(saveLastSession).not.toHaveBeenCalled()
  })
})

describe('App auto-analyze on import', () => {
  // With the setting on, suspect rips surface on their own: every imported track queues
  // its quality analysis in the background, so the user never has to know the Analyze
  // button exists to be protected from fake-lossless files.
  it('measures imported tracks without pressing Analyze when enabled', async () => {
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ autoAnalyze: true })),
      readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }),
    })
    await renderApp()
    await addTwoTracks()
    await waitFor(() => expect(screen.getAllByTestId('track-quality')).toHaveLength(2))
  })

  // Off by default: importing must not spend an ffmpeg decode per row behind the
  // user's back — that cost is exactly why the setting is opt-in.
  it('does not analyze imports while the setting is off', async () => {
    const spectrogram = vi.fn().mockResolvedValue(spectrum)
    setApi({ spectrogram })
    await renderApp()
    await addTwoTracks()
    // The auto-selected first row's editor measures itself (its own high-priority query);
    // the unselected second row is what the off setting must leave untouched.
    await waitFor(() => expect(spectrogram).toHaveBeenCalled())
    expect(spectrogram).not.toHaveBeenCalledWith('/music/b.wav', expect.anything())
  })
})

describe('App paste metadata feedback', () => {
  // Copying tags confirms with a toast but pasting used to be silent — on a multi-row
  // paste spree the user couldn't tell whether the shortcut landed. Both halves of the
  // copy/paste pair must speak.
  it('confirms a pasted tag set with the same toast the copy shows', async () => {
    setApi({
      readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }),
    })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.contextMenu(rows[0])
    fireEvent.click(await screen.findByTestId('track-menu-copy-meta'))
    expect(await screen.findByText('Metadata copied')).toBeInTheDocument()

    fireEvent.contextMenu(rows[1])
    fireEvent.click(await screen.findByTestId('track-menu-paste-meta'))
    expect(await screen.findByText('Metadata pasted')).toBeInTheDocument()
  })
})

describe('App duplicates filter', () => {
  // The download-folder case this bucket exists for: the same song arriving as two
  // files. The bucket only appears once a real duplicate pair exists, and picking it
  // narrows the list to the group so the user can choose which copy to keep.
  it('lists a duplicates bucket and filters to the duplicated rows', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.flac', '/music/c.wav']),
      readTags: vi.fn((path: string) =>
        Promise.resolve(
          path.includes('/c.')
            ? { title: 'Unique', artist: 'Someone' }
            : { title: 'Strobe', artist: 'deadmau5' },
        ),
      ),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))

    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(await screen.findByTestId('quality-filter-duplicates'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
  })

  // Without a duplicated pair the bucket must not exist — an empty filter row would
  // just pad the menu with a dead entry.
  it('lists no duplicates bucket when every track is unique', async () => {
    setApi({
      readTags: vi.fn((path: string) =>
        Promise.resolve({ title: path.includes('/a.') ? 'One' : 'Two', artist: 'X' }),
      ),
    })
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    expect(screen.queryByTestId('quality-filter-duplicates')).toBeNull()
  })
})
