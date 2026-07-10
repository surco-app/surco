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
  return { id, title, enabled: true, group: 'app', run: () => {} }
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
    batching: false,
    cancelBatch: () => {},
    editorFormatRef: { current: null },
    editorDestinationRef: { current: null },
    editorNormalizeRef: { current: null },
    trackSearchRef: { current: null },
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
    playerVisible: false,
    seek: () => {},
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
    askTrashSuspects: () => {},
    askTrashSelected: () => {},
    bulkTracks: [],
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
    numberTracks: () => {},
    applyTitleFormat: () => {},
    titleFormatSet: false,
    undoMeta: () => {},
    canUndoMeta: () => false,
    acceptReview: () => {},
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
  // Spanish (and French, Portuguese…) command titles carry accents the user won't
  // bother typing in a quick launcher: "titulo" must find "título", and an accented
  // query must still find an unaccented title.
  it('matches ignoring accents in both the query and the title', () => {
    const cmds = [cmd('apply-title-format', 'Aplicar el formato del título a la selección')]
    expect(filterCommands(cmds, 'titulo', {}).map((c) => c.id)).toEqual(['apply-title-format'])
    expect(filterCommands(cmds, 'formáto', {}).map((c) => c.id)).toEqual(['apply-title-format'])
  })


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

  // Frecency: among the commands that match the query, the ones the user runs most
  // rise to the top. "Clear the list" beats "Clear metadata" when it's used more, even
  // though it's declared later — so the habitual choice lands under the cursor.
  it('orders matches by usage count so the most-used command leads', () => {
    const cmds = [cmd('clear-meta', 'Clear metadata'), cmd('clear-list', 'Clear the list')]
    const ordered = filterCommands(cmds, 'clear', { 'clear-list': 5, 'clear-meta': 1 })
    expect(ordered.map((c) => c.id)).toEqual(['clear-list', 'clear-meta'])
  })

  // A tie (or two never-used commands) keeps the declarative order, so the list stays
  // predictable instead of shuffling arbitrarily.
  it('falls back to declarative order when usage is equal', () => {
    const cmds = [cmd('clear-meta', 'Clear metadata'), cmd('clear-list', 'Clear the list')]
    expect(filterCommands(cmds, 'clear', {}).map((c) => c.id)).toEqual(['clear-meta', 'clear-list'])
    expect(
      filterCommands(cmds, 'clear', { 'clear-meta': 3, 'clear-list': 3 }).map((c) => c.id),
    ).toEqual(['clear-meta', 'clear-list'])
  })

  // An empty query stays in declarative order regardless of usage: the browsable menu
  // the user has memorized must not reshuffle just because some commands are used more.
  it('keeps declarative order for an empty query even with usage data', () => {
    expect(filterCommands(commands, '', { all: 99 }).map((c) => c.id)).toEqual([
      'add',
      'settings',
      'all',
    ])
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
    runCommand([{ id: 'add', title: '', enabled: true, group: 'library', run }], 'add')
    expect(run).toHaveBeenCalledOnce()
  })

  it('never runs a disabled command', () => {
    const run = vi.fn()
    runCommand([{ id: 'add', title: '', enabled: false, group: 'library', run }], 'add')
    expect(run).not.toHaveBeenCalled()
  })

  it('does nothing for an unknown id', () => {
    const run = vi.fn()
    runCommand([{ id: 'add', title: '', enabled: true, group: 'library', run }], 'missing')
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
    expect(processOne).toHaveBeenCalledWith('t1', undefined, undefined, undefined, undefined)
    expect(moveSelection).toHaveBeenCalledWith(1)
  })
})

describe('buildCommands process-all toggle', () => {
  // Like the sweep commands, 'process-all' flips meaning mid-run: a misfired Convert
  // all must be cancellable from the same palette entry that started it, instead of
  // running unstoppably to the end of the crate.
  it('cancels the running batch instead of starting another', () => {
    const cancelBatch = vi.fn()
    const askConvertAll = vi.fn()
    const cmd = commandById(
      makeDeps({ batching: true, canProcessAll: false, cancelBatch, askConvertAll }),
      'process-all',
    )
    expect(cmd.enabled).toBe(true)
    cmd.run()
    expect(cancelBatch).toHaveBeenCalledOnce()
    expect(askConvertAll).not.toHaveBeenCalled()
  })
})

describe('buildCommands trash-suspects gate', () => {
  const suspect = (id: string) =>
    track({
      id,
      spectrum: { image: '', cutoffHz: 16000, sampleRateHz: 44100 },
    } as Partial<TrackItem>)
  const clean = (id: string) =>
    track({
      id,
      spectrum: { image: '', cutoffHz: 21000, sampleRateHz: 44100 },
    } as Partial<TrackItem>)

  // The action deletes files, so it must stay disabled unless the visible list actually holds a
  // flagged rip — a DJ hitting it on an all-clean crate should find nothing to run, not an
  // empty confirmed deletion. It reads the visible set so a filter that hides the fakes disables it.
  it('enables the action only when a visible track is flagged as suspect', () => {
    expect(
      commandById(makeDeps({ visibleTracks: [suspect('a'), clean('b')] }), 'trash-suspects')
        .enabled,
    ).toBe(true)
    expect(
      commandById(makeDeps({ visibleTracks: [clean('a'), clean('b')] }), 'trash-suspects').enabled,
    ).toBe(false)
    expect(commandById(makeDeps({ visibleTracks: [] }), 'trash-suspects').enabled).toBe(false)
  })

  // Running it delegates to the injected flow (which confirms and trashes) rather than deleting
  // inline, keeping the destructive path routed through App's confirm dialog.
  it('runs the injected trash flow', () => {
    const askTrashSuspects = vi.fn()
    commandById(
      makeDeps({ visibleTracks: [suspect('a')], askTrashSuspects }),
      'trash-suspects',
    ).run()
    expect(askTrashSuspects).toHaveBeenCalledOnce()
  })
})

describe('buildCommands accept-review gate', () => {
  // Accepting a review suggestion only makes sense when the selected track carries one, so the
  // command (and its shortcut) stay disabled otherwise — running it on a track with no pending
  // suggestion would be a confusing no-op the user can't tell from a failure.
  it('enables accept-review only when the selected track has a pending suggestion', () => {
    const withReview = track({
      reviewMatch: { release: {}, track: {}, result: {} },
    } as Partial<TrackItem>)
    expect(commandById(makeDeps({ selected: withReview }), 'accept-review').enabled).toBe(true)
    expect(commandById(makeDeps({ selected: track() }), 'accept-review').enabled).toBe(false)
    expect(commandById(makeDeps({ selected: null }), 'accept-review').enabled).toBe(false)
  })

  it('runs the injected accept-review flow', () => {
    const acceptReview = vi.fn()
    const withReview = track({
      reviewMatch: { release: {}, track: {}, result: {} },
    } as Partial<TrackItem>)
    commandById(makeDeps({ selected: withReview, acceptReview }), 'accept-review').run()
    expect(acceptReview).toHaveBeenCalledOnce()
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

  // The ←/→ seek nudges the playhead by ±5s and is gated on the player being open, so the
  // arrows never scrub a closed player. Pinning the sign guards the two commands don't swap.
  it('seeks ±5s only while the player is open', () => {
    const seek = vi.fn()
    const closed = makeDeps({ seek, playerVisible: false })
    expect(commandById(closed, 'seek-back').enabled).toBe(false)
    expect(commandById(closed, 'seek-forward').enabled).toBe(false)

    const open = makeDeps({ seek, playerVisible: true })
    const back = commandById(open, 'seek-back')
    const forward = commandById(open, 'seek-forward')
    expect(back.enabled).toBe(true)
    back.run()
    expect(seek).toHaveBeenCalledWith(-5)
    forward.run()
    expect(seek).toHaveBeenCalledWith(5)
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

  // The title-format apply needs BOTH a selection to act on and a configured format —
  // with either missing the command would be a silent no-op, so it greys out instead.
  it('gates apply-title-format on a selection and a configured format, and runs it', () => {
    const applyTitleFormat = vi.fn()
    const noFormat = makeDeps({ applyTitleFormat, selected: track(), titleFormatSet: false })
    expect(commandById(noFormat, 'apply-title-format').enabled).toBe(false)
    const noSelection = makeDeps({ applyTitleFormat, selected: null, titleFormatSet: true })
    expect(commandById(noSelection, 'apply-title-format').enabled).toBe(false)

    const ready = makeDeps({ applyTitleFormat, selected: track(), titleFormatSet: true })
    const cmd = commandById(ready, 'apply-title-format')
    expect(cmd.enabled).toBe(true)
    cmd.run()
    expect(applyTitleFormat).toHaveBeenCalledOnce()
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

  // Numbering stamps 1..N over the bulk scope's track numbers; with a single track
  // in scope there is no order to write, so the palette greys the entry out.
  it('gates number-tracks on a multi-track scope and runs it', () => {
    const numberTracks = vi.fn()
    const single = makeDeps({ numberTracks, bulkTracks: [track()] })
    expect(commandById(single, 'number-tracks').enabled).toBe(false)

    const many = makeDeps({ numberTracks, bulkTracks: [track(), track({ id: 't2' })] })
    const command = commandById(many, 'number-tracks')
    expect(command.enabled).toBe(true)
    command.run()
    expect(numberTracks).toHaveBeenCalledOnce()
  })

  // Undo is only offered while there is something recorded to roll back — a dead entry
  // in the palette would promise a recovery that can't happen.
  it('gates undo-meta on a non-empty undo stack and runs it', () => {
    const undoMeta = vi.fn()
    expect(commandById(makeDeps({ undoMeta, canUndoMeta: () => false }), 'undo-meta').enabled).toBe(
      false,
    )
    const cmd = commandById(makeDeps({ undoMeta, canUndoMeta: () => true }), 'undo-meta')
    expect(cmd.enabled).toBe(true)
    cmd.run()
    expect(undoMeta).toHaveBeenCalledOnce()
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

describe('buildCommands trash-selected gate', () => {
  // The palette's "Move the selection to Trash" mirrors the context menu action; with
  // nothing selected there is nothing to trash, so the entry must read as unavailable.
  it('enables the action only with a selection', () => {
    expect(commandById(makeDeps({ selected: track() }), 'trash-selected').enabled).toBe(true)
    expect(commandById(makeDeps({ selectedTracksCount: 3 }), 'trash-selected').enabled).toBe(true)
    expect(commandById(makeDeps(), 'trash-selected').enabled).toBe(false)
  })

  // Running it delegates to the injected flow (which confirms and trashes) rather than
  // deleting inline, keeping the destructive path routed through App's confirm dialog.
  it('runs the injected trash flow', () => {
    const askTrashSelected = vi.fn()
    commandById(makeDeps({ askTrashSelected, selected: track() }), 'trash-selected').run()
    expect(askTrashSelected).toHaveBeenCalled()
  })
})

describe('buildCommands bulk scope', () => {
  // The palette's Convert-all and Auto-match must act on the shared bulk scope (a
  // deliberate multi-selection when there is one, else the visible rows) — the same
  // set the toolbar's own buttons sweep — never unconditionally on the visible list.
  it('converts the bulk scope, not the visible rows', () => {
    const askConvertAll = vi.fn()
    const bulk = [track({ id: 'sel1' }), track({ id: 'sel2' })]
    commandById(
      makeDeps({
        canProcessAll: true,
        askConvertAll,
        bulkTracks: bulk,
        visibleTracks: [track({ id: 'other' })],
      }),
      'process-all',
    ).run()
    expect(askConvertAll).toHaveBeenCalledWith(bulk, undefined, undefined, undefined)
  })

  it('auto-matches the bulk scope, not the visible rows', () => {
    const enqueueAutoMatch = vi.fn()
    const bulk = [track({ id: 'sel1' })]
    commandById(
      makeDeps({
        settings: { outputFormat: 'aiff', discogsToken: 'tok' } as Settings,
        autoMatchable: 1,
        enqueueAutoMatch,
        bulkTracks: bulk,
        visibleTracks: [track({ id: 'other' })],
      }),
      'auto-match',
    ).run()
    expect(enqueueAutoMatch).toHaveBeenCalledWith(bulk, false)
  })
})
