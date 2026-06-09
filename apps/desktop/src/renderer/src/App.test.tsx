// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../../shared/types'
import './i18n'

afterEach(cleanup)

function settings(over: Partial<Settings> = {}): Settings {
  return {
    theme: 'system',
    discogsToken: '',
    outputDir: '',
    outputFormat: 'aiff',
    addToAppleMusic: false,
    filenameFormat: '{artist} - {title}',
    groupingPresets: [],
    genrePresets: [],
    trimWhitespace: true,
    zeroPadTrack: true,
    visibleFields: ['title', 'artist'],
    requiredFields: ['title', 'artist'],
    coverMaxSize: 1000,
    coverSquare: false,
    showSpectrum: true,
    showLoudness: false,
    autoMatch: false,
    normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
    shortcutOverrides: {},
    hasSeenOnboarding: true,
    conversionCount: 0,
    ...over,
  }
}

// A clear cutoff well below Nyquist so the verdict is a real value (not 'unanalyzed'),
// which is what makes a quality dot appear on the row.
const spectrum = { image: 'data:image/png;base64,', cutoffHz: 16000, sampleRateHz: 44100 }

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

function scrollRowIntoView(row: HTMLElement): void {
  const li = row.closest('li')
  if (!li) return
  for (const o of observers)
    if (o.els.has(li))
      o.cb(
        [{ target: li, isIntersecting: true } as unknown as IntersectionObserverEntry],
        o as unknown as IntersectionObserver,
      )
}

function setApi(over: Record<string, unknown> = {}): void {
  ;(window as unknown as { api: unknown }).api = {
    platform: 'win32',
    version: '0.0.0-test',
    getSettings: vi.fn().mockResolvedValue(settings()),
    onMenuCommand: () => () => {},
    onProcessProgress: () => () => {},
    onUpdateDownloaded: () => () => {},
    onUpdateError: () => () => {},
    onOpenFiles: () => () => {},
    takePendingFiles: vi.fn().mockResolvedValue([]),
    expandPaths: vi.fn((paths: string[]) => Promise.resolve(paths)),
    onWindowFocus: () => () => {},
    pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
    readTags: vi.fn().mockResolvedValue({}),
    readDuration: vi.fn().mockResolvedValue(180),
    readCover: vi.fn().mockResolvedValue(null),
    properties: vi.fn().mockResolvedValue(null),
    loudness: vi.fn().mockResolvedValue(null),
    searchDiscogs: vi.fn().mockResolvedValue([]),
    getRelease: vi.fn().mockResolvedValue(null),
    spectrogram: vi.fn().mockResolvedValue(spectrum),
    ...over,
  }
}

beforeEach(() => {
  setApi()
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
})

// App and parts of its tree read window.api.platform at module scope, so it must be
// imported only after the bridge mock is in place — a dynamic import after beforeEach.
async function renderApp(): Promise<void> {
  const { default: App } = await import('./App')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
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

  // Starting the sweep then switching away must not keep ffmpeg churning in the
  // background: the sweep parks until the window is focused again, the whole point of
  // the blur pause (it must still finish once the app comes back).
  it('parks the analyze sweep while the window is in the background and resumes on focus', async () => {
    let setFocus: (focused: boolean) => void = () => {}
    const spectrogram = vi.fn().mockResolvedValue(spectrum)
    setApi({
      spectrogram,
      onWindowFocus: (cb: (focused: boolean) => void) => {
        setFocus = cb
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
    const searchDiscogs = vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }])
    const getRelease = vi.fn().mockResolvedValue(release)
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ discogsToken: 'tok' })),
      // A title + duration the release agrees with scores 'high', the bar for applying.
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
      readDuration: vi.fn().mockResolvedValue(180),
      searchDiscogs,
      getRelease,
    })
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getByTestId('auto-match'))
    await waitFor(() => expect(screen.getAllByTestId('track-automatched')).toHaveLength(2))
    expect(searchDiscogs).toHaveBeenCalled()
  })

  it('leaves the button disabled without a Discogs token to search', async () => {
    setApi({ readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }) })
    await renderApp()
    await addTwoTracks()
    expect(screen.getByTestId('auto-match')).toBeDisabled()
  })

  // Dropping a folder of 100 must not fire 100 Discogs searches at once and trip the rate
  // limit. Import auto-match is gated to the rows on screen: nothing probes until a row is
  // scrolled into view, and then only that row's file is searched.
  it('probes only the tracks scrolled into view on import, not the whole drop', async () => {
    const searchDiscogs = vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }])
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ discogsToken: 'tok', autoMatch: true })),
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
      readDuration: vi.fn().mockResolvedValue(180),
      searchDiscogs,
      getRelease: vi.fn().mockResolvedValue(release),
    })
    await renderApp()
    await addTwoTracks()

    // No row is reported visible yet, so the import enqueued both but probed neither.
    await Promise.resolve()
    expect(searchDiscogs).not.toHaveBeenCalled()

    scrollRowIntoView(screen.getAllByTestId('track-row')[0])
    await waitFor(() => expect(screen.getAllByTestId('track-automatched')).toHaveLength(1))
    expect(searchDiscogs).toHaveBeenCalledTimes(1)
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
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    const row = screen.getByTestId('track-row')
    expect(within(row).getByText('Imported Title')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('field-title'), { target: { value: 'Hand Typed' } })

    expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('Hand Typed')
    expect(within(row).getByText('Imported Title')).toBeInTheDocument()
    expect(within(row).queryByText('Hand Typed')).not.toBeInTheDocument()
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

describe('App header convert button', () => {
  // The header button must act on the current selection, not the whole crate: the same reason
  // as the editor — a user picks the few tracks they've finished and expects only those to run.
  // The label carries the selection count so it never promises to convert more than it will.
  it('converts only the selected tracks and labels the selection count', async () => {
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
    const button = screen.getByTestId('convert-selected')
    expect(button).toHaveTextContent('Convert (2)')
    fireEvent.click(button)
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(2))
    const converted = processTrack.mock.calls.map((c) => c[0].inputPath).sort()
    expect(converted).toEqual(['/music/a.wav', '/music/b.wav'])
  })
})
