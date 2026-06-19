import { describe, expect, it, vi } from 'vitest'
import type { Settings } from '../../../shared/types'
import type { TrackItem } from '../types'
import {
  buildCommands,
  type Command,
  type CommandDeps,
  filterCommands,
  guideUrl,
  runCommand,
} from './commands'

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
    tracksView: [],
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
    openHelp: () => {},
    toggleLanguage: () => {},
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
})
