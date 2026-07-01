import { describe, expect, it, vi } from 'vitest'
import type { Settings } from '../../../shared/types'
import type { TrackItem } from '../types'
import {
  buildCommands,
  type Command,
  type CommandDeps,
  filterCommands,
  filterTrackCommands,
  guideUrl,
  runCommand,
  trackLabel,
} from './commands'
import { DONATE_URL } from './donate'

function cmd(id: string, title: string): Command {
  return { id, title, enabled: true, run: () => {} }
}

function track(overrides: Partial<TrackItem> = {}): TrackItem {
  return {
    id: 't1',
    inputPath: '/in/a.wav',
    fileName: 'a.wav',
    query: '',
    meta: {} as TrackItem['meta'],
    listLabel: 'a',
    status: 'done',
    outputPath: '/out/a.aiff',
    ...overrides,
  } as TrackItem
}

function makeDeps(overrides: Partial<CommandDeps> = {}): CommandDeps {
  return {
    tr: (k) => k,
    hintFor: () => '',
    platform: 'darwin',
    tracks: [],
    visibleTracks: [],
    selected: null,
    selectedTracksCount: 0,
    settings: { outputFormat: 'aiff' } as Settings,
    analysis: null,
    matching: null,
    autoMatchable: 0,
    canProcessSelected: false,
    canProcessAll: false,
    editorFormatRef: { current: null },
    editorNormalizeRef: { current: null },
    searchInputRef: { current: null },
    pickFiles: () => {},
    selectAll: () => {},
    askFillAll: () => {},
    moveSelection: () => {},
    jumpSelection: () => {},
    pageSelection: () => {},
    focusList: () => {},
    focusMatches: () => {},
    focusEditor: () => {},
    togglePlay: () => {},
    processOne: () => {},
    askConvertAll: () => {},
    cancelAnalysis: () => {},
    analyzeAllQuality: () => {},
    cancelAutoMatch: () => {},
    enqueueAutoMatch: () => {},
    addTrackToAppleMusic: () => {},
    removeTrack: () => {},
    reveal: () => {},
    askClearAll: () => {},
    openSettings: () => {},
    openFindReplace: () => {},
    openExport: () => {},
    openRename: () => {},
    openActivity: () => {},
    openHelp: () => {},
    toggleLanguage: () => {},
    toggleTheme: () => {},
    clearMeta: () => {},
    deriveTags: () => {},
    fireConfetti: () => {},
    ...overrides,
  }
}

function commandById(deps: CommandDeps, id: string): Command {
  const c = buildCommands(deps).find((c) => c.id === id)
  if (!c) throw new Error(`command ${id} not found`)
  return c
}

const commands = [
  cmd('add', 'Añadir archivos'),
  cmd('settings', 'Ajustes'),
  cmd('all', 'Procesar todo'),
]

describe('guideUrl', () => {
  // The web guide ships per-language at distinct paths, so a Spanish user must
  // not be dropped on the English page (and vice versa) when they open it.
  it('sends Spanish users to the Spanish guide', () => {
    expect(guideUrl('es')).toBe('https://getsurco.app/guia')
  })

  it('sends every other locale to the English guide', () => {
    expect(guideUrl('en')).toBe('https://getsurco.app/en/guide')
    expect(guideUrl('fr')).toBe('https://getsurco.app/en/guide')
  })
})

describe('filterCommands', () => {
  it('returns every command when the query is empty, so the menu is browsable', () => {
    expect(filterCommands(commands, '').map((c) => c.id)).toEqual(['add', 'settings', 'all'])
  })

  it('matches case-insensitively on a substring of the title', () => {
    expect(filterCommands(commands, 'proc').map((c) => c.id)).toEqual(['all'])
    expect(filterCommands(commands, 'AJUSTES').map((c) => c.id)).toEqual(['settings'])
  })

  it('ignores surrounding whitespace in the query', () => {
    expect(filterCommands(commands, '  add ').map((c) => c.id)).toEqual([])
    expect(filterCommands(commands, '  añadir ').map((c) => c.id)).toEqual(['add'])
  })

  it('returns nothing when no title matches', () => {
    expect(filterCommands(commands, 'zzz')).toEqual([])
  })
})

function meta(artist: string, title: string): TrackItem['meta'] {
  return { artist, title } as TrackItem['meta']
}

describe('trackLabel', () => {
  it('joins artist and title when both are present', () => {
    expect(trackLabel(track({ meta: meta('Daft Punk', 'Da Funk') }))).toBe('Daft Punk — Da Funk')
  })

  it('falls back to whichever of title, artist or list label exists', () => {
    expect(trackLabel(track({ meta: meta('', 'Da Funk') }))).toBe('Da Funk')
    expect(trackLabel(track({ meta: meta('', ''), listLabel: 'rawfile' }))).toBe('rawfile')
  })
})

describe('filterTrackCommands', () => {
  const tracks = [
    track({ id: 't1', meta: meta('Daft Punk', 'Da Funk') }),
    track({ id: 't2', meta: meta('Justice', 'Genesis') }),
    track({ id: 't3', meta: meta('', ''), listLabel: 'untitled-daft-demo' }),
  ]

  it('returns nothing for an empty query, so ⌘K stays a command launcher until you type', () => {
    expect(filterTrackCommands(tracks, '  ', () => {})).toEqual([])
  })

  it('matches case-insensitively across artist, title and the frozen list label', () => {
    expect(filterTrackCommands(tracks, 'daft', () => {}).map((c) => c.id)).toEqual([
      'goto:t1',
      'goto:t3',
    ])
    expect(filterTrackCommands(tracks, 'GENESIS', () => {}).map((c) => c.id)).toEqual(['goto:t2'])
  })

  it('jumps to the track id when its result runs', () => {
    const goToTrack = vi.fn()
    filterTrackCommands(tracks, 'justice', goToTrack)[0].run()
    expect(goToTrack).toHaveBeenCalledWith('t2')
  })

  it('caps the results so a broad query cannot flood the palette', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      track({ id: `m${i}`, meta: meta('Mix', `Track ${i}`) }),
    )
    expect(filterTrackCommands(many, 'mix', () => {}).length).toBe(8)
  })
})

describe('runCommand', () => {
  // The palette, the keyboard shortcuts and the native menu all trigger actions
  // by command id. Routing them through one runner keeps the three in sync and
  // enforces the `enabled` gate in a single place, so a disabled action can
  // never fire no matter which surface invoked it.
  it('runs the matching command when it is enabled', () => {
    const run = vi.fn()
    runCommand([{ id: 'add', title: '', enabled: true, run }], 'add')
    expect(run).toHaveBeenCalledOnce()
  })

  it('never runs a disabled command', () => {
    const run = vi.fn()
    runCommand([{ id: 'add', title: '', enabled: false, run }], 'add')
    expect(run).not.toHaveBeenCalled()
  })

  it('does nothing for an unknown id', () => {
    const run = vi.fn()
    runCommand([{ id: 'add', title: '', enabled: true, run }], 'missing')
    expect(run).not.toHaveBeenCalled()
  })
})

describe('buildCommands convert-and-advance', () => {
  // ⌘⏎ kicks off the current track's conversion (which runs in the background) and moves
  // to the next track, so the shortcut works through the crate without a manual step.
  it('processes the selected track then advances the selection', () => {
    const processOne = vi.fn()
    const moveSelection = vi.fn()
    const cmd = commandById(
      makeDeps({ selected: track(), canProcessSelected: true, processOne, moveSelection }),
      'process-current',
    )
    cmd.run()
    expect(processOne).toHaveBeenCalledWith('t1', undefined, undefined)
    expect(moveSelection).toHaveBeenCalledWith(1)
  })
})

describe('buildCommands platform-gated entries', () => {
  // The "add to Apple Music" command is the only one whose enabled state turns on the
  // host OS: the Music AppleScript bridge is macOS-only. These pin that gate so a future
  // refactor of how the platform reaches buildCommands cannot silently offer the action
  // on Windows/Linux or hide it on macOS.
  it('enables "add to Apple Music" on macOS for a converted non-FLAC track', () => {
    const deps = makeDeps({ platform: 'darwin', selected: track() })
    expect(commandById(deps, 'add-apple-music').enabled).toBe(true)
  })

  it('disables "add to Apple Music" off macOS even for the same track', () => {
    const deps = makeDeps({ platform: 'win32', selected: track() })
    expect(commandById(deps, 'add-apple-music').enabled).toBe(false)
  })

  // Reveal-in-finder is enabled only once a track has an output on disk, and running it
  // hands that exact path to the injected reveal. Pinning both halves guards that the
  // registry routes the reveal through its dependency rather than calling window.api.
  it('reveals the selected track output path and is gated on it existing', () => {
    const reveal = vi.fn()
    const withOutput = commandById(makeDeps({ reveal, selected: track() }), 'reveal')
    expect(withOutput.enabled).toBe(true)
    withOutput.run()
    expect(reveal).toHaveBeenCalledWith('/out/a.aiff')

    const noOutput = commandById(
      makeDeps({ reveal, selected: track({ outputPath: undefined }) }),
      'reveal',
    )
    expect(noOutput.enabled).toBe(false)
  })

  // The donate command is a launcher for the PayPal page and is always available, so
  // support reaches it from ⌘K without needing a track loaded. Pinning the URL guards
  // against it drifting away from the single DONATE_URL the Stats tab and nudge share.
  it('always offers the donate command and opens the shared donate URL', () => {
    const open = vi.fn()
    vi.stubGlobal('window', { open })
    const donate = commandById(makeDeps(), 'donate')
    expect(donate.enabled).toBe(true)
    donate.run()
    expect(open).toHaveBeenCalledWith(DONATE_URL)
    vi.unstubAllGlobals()
  })
})

describe('buildCommands editor + theme entries', () => {
  // Theme is global chrome like the language toggle, so it's always reachable from ⌘K —
  // no track needed — and simply rotates through the three preferences.
  it('always offers toggle-theme and runs it', () => {
    const toggleTheme = vi.fn()
    const cmd = commandById(makeDeps({ toggleTheme }), 'toggle-theme')
    expect(cmd.enabled).toBe(true)
    cmd.run()
    expect(toggleTheme).toHaveBeenCalledOnce()
  })

  // Clear-metadata and derive-from-filename act on the current selection, so both must be
  // gated on a track being selected — firing them with nothing selected would be a no-op
  // the user can't see, so the palette greys them out instead.
  it('gates clear-meta and derive-tags on a selected track and runs them', () => {
    const clearMeta = vi.fn()
    const deriveTags = vi.fn()
    const none = makeDeps({ clearMeta, deriveTags, selected: null })
    expect(commandById(none, 'clear-meta').enabled).toBe(false)
    expect(commandById(none, 'derive-tags').enabled).toBe(false)

    const withSel = makeDeps({ clearMeta, deriveTags, selected: track() })
    const clear = commandById(withSel, 'clear-meta')
    const derive = commandById(withSel, 'derive-tags')
    expect(clear.enabled).toBe(true)
    expect(derive.enabled).toBe(true)
    clear.run()
    derive.run()
    expect(clearMeta).toHaveBeenCalledOnce()
    expect(deriveTags).toHaveBeenCalledOnce()
  })

  // The confetti command is pure fun, always available, and just fires the burst.
  it('always offers confetti and fires it', () => {
    const fireConfetti = vi.fn()
    const cmd = commandById(makeDeps({ fireConfetti }), 'confetti')
    expect(cmd.enabled).toBe(true)
    cmd.run()
    expect(fireConfetti).toHaveBeenCalledOnce()
  })
})
